import { getPrisma, type Prisma } from "@hubadvisor/db";
import { createHash, randomBytes } from "node:crypto";

// Rede de atacado B2B (ADR-024). Lógica do marketplace cross-tenant consumida
// pelo MCP Server. Catálogo agregado = produtos com `wholesaleEnabled` de TODAS
// as lojas. A parte de validação/precificação é pura (testável sem DB).

export type WholesaleProductView = {
  productId: string;
  sellerTenantId: string;
  name: string;
  description?: string | null;
  wholesalePriceBRL: number;
  minQty: number;
  available: number;            // soma do estoque das variantes
  styles: string[];
  occasions: string[];
  mainPhoto?: string | null;
  variants: Array<{ sku: string; color?: string; size?: string; stock: number }>;
};

export type QuoteLineInput = { productId: string; qty: number; sku?: string };

// Produto cru (como vem do Prisma) — campos usados na precificação/validação.
export type RawWholesaleProduct = {
  id: string;
  tenantId: string;
  name: string;
  priceBRL: unknown;
  wholesalePriceBRL: unknown;
  wholesaleMinQty: number;
  wholesaleEnabled: boolean;
  active: boolean;
  variants: unknown;
};

const num = (v: unknown): number => (v == null ? 0 : Number(v));

// ============================================================
// Auth do comprador (API-key) — ADR-024
// ============================================================
/** Hash determinístico da API-key (sha256 hex) — guardamos só o hash. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

/** Cria um comprador e devolve a API-key em CLARO uma única vez. */
export async function createBuyer(name: string, tenantId?: string) {
  const key = "b2b_" + randomBytes(24).toString("hex");
  const buyer = await getPrisma().b2bBuyer.create({
    data: { name, apiKeyHash: hashApiKey(key), tenantId: tenantId ?? null },
  });
  return { buyerId: buyer.id, name: buyer.name, apiKey: key };
}

/** Resolve a API-key → comprador ativo (ou null). Usado pelo servidor MCP. */
export async function resolveBuyer(apiKey: string | undefined | null): Promise<{ id: string; name: string } | null> {
  if (!apiKey) return null;
  const buyer = await getPrisma().b2bBuyer.findUnique({ where: { apiKeyHash: hashApiKey(apiKey) } });
  if (!buyer || !buyer.active) return null;
  return { id: buyer.id, name: buyer.name };
}

/** Preço de atacado do produto (cai pro preço normal se não houver). */
export function wholesaleUnitPrice(p: RawWholesaleProduct): number {
  return p.wholesalePriceBRL != null ? num(p.wholesalePriceBRL) : num(p.priceBRL);
}

/** Estoque disponível: do SKU específico, ou soma de todas as variantes. */
export function availableStock(p: RawWholesaleProduct, sku?: string): number {
  const vs = (p.variants as Array<{ sku: string; stock?: number }>) ?? [];
  if (sku) return num(vs.find((v) => v.sku === sku)?.stock);
  return vs.reduce((s, v) => s + num(v.stock), 0);
}

export type BuiltQuote =
  | { ok: false; errors: string[] }
  | {
      ok: true;
      sellerTenantId: string;
      totalBRL: number;
      lines: Array<{ productId: string; name: string; sku: string | null; qty: number; unitWholesaleBRL: number; lineTotalBRL: number }>;
    };

/**
 * Monta e VALIDA uma cotação de atacado (função pura). Regras: produto existe e
 * está exposto; respeita quantidade mínima; tem estoque; e todas as linhas são
 * do MESMO vendedor (um pedido B2B é por loja). Devolve total e linhas, ou erros.
 */
export function buildWholesaleQuote(products: RawWholesaleProduct[], lines: QuoteLineInput[]): BuiltQuote {
  const byId = new Map(products.map((p) => [p.id, p]));
  const errors: string[] = [];
  const built: Array<{ productId: string; name: string; sku: string | null; qty: number; unitWholesaleBRL: number; lineTotalBRL: number }> = [];
  const sellers = new Set<string>();

  if (lines.length === 0) errors.push("cotação sem itens");

  for (const line of lines) {
    const p = byId.get(line.productId);
    if (!p || !p.wholesaleEnabled || !p.active) { errors.push(`produto ${line.productId} não está disponível no atacado`); continue; }
    if (!Number.isInteger(line.qty) || line.qty <= 0) { errors.push(`quantidade inválida para ${p.name}`); continue; }
    if (line.qty < p.wholesaleMinQty) { errors.push(`${p.name}: quantidade mínima de atacado é ${p.wholesaleMinQty}`); continue; }
    const avail = availableStock(p, line.sku);
    if (avail < line.qty) { errors.push(`${p.name}: estoque insuficiente (${avail} disponível)`); continue; }
    sellers.add(p.tenantId);
    const unit = wholesaleUnitPrice(p);
    built.push({ productId: p.id, name: p.name, sku: line.sku ?? null, qty: line.qty, unitWholesaleBRL: unit, lineTotalBRL: round2(unit * line.qty) });
  }

  if (sellers.size > 1) errors.push("uma cotação só pode ter itens de um único vendedor");
  if (errors.length) return { ok: false, errors };

  const totalBRL = round2(built.reduce((s, l) => s + l.lineTotalBRL, 0));
  return { ok: true, sellerTenantId: [...sellers][0]!, totalBRL, lines: built };
}

const round2 = (x: number) => Number(x.toFixed(2));

// ============================================================
// Comissão da plataforma (ADR-024 — monetização)
// ============================================================
/** Taxa de comissão B2B (fração 0..1). Env `B2B_COMMISSION_PCT`, default 5%. */
export function commissionRate(): number {
  const v = Number(process.env.B2B_COMMISSION_PCT);
  if (!Number.isFinite(v) || v < 0) return 0.05;
  return Math.min(v, 1);
}

/** Comissão e líquido do vendedor a partir do total (função pura). */
export function computeCommission(totalBRL: number, rate = commissionRate()) {
  const commissionBRL = round2(totalBRL * rate);
  return { commissionPct: rate, commissionBRL, sellerNetBRL: round2(totalBRL - commissionBRL) };
}

// ============================================================
// Camada de dados (consumida pelo MCP Server)
// ============================================================

function toView(p: any): WholesaleProductView {
  const media = (p.media as { mainPhoto?: string; photos?: string[] } | null) ?? null;
  return {
    productId: p.id,
    sellerTenantId: p.tenantId,
    name: p.name,
    description: p.description,
    wholesalePriceBRL: wholesaleUnitPrice(p),
    minQty: p.wholesaleMinQty,
    available: availableStock(p),
    styles: p.styles ?? [],
    occasions: p.occasions ?? [],
    mainPhoto: media?.mainPhoto ?? media?.photos?.[0] ?? null,
    variants: ((p.variants as Array<{ sku: string; color?: string; size?: string; stock?: number }>) ?? [])
      .map((v) => ({ sku: v.sku, color: v.color, size: v.size, stock: num(v.stock) })),
  };
}

const WHOLESALE_WHERE = { wholesaleEnabled: true, active: true } as const;

/** Busca no catálogo agregado (texto no nome/descrição + filtros de estilo/ocasião). */
export async function searchWholesale(query?: string, filters?: { styles?: string[]; occasions?: string[]; limit?: number }) {
  const products = await getPrisma().product.findMany({
    where: {
      ...WHOLESALE_WHERE,
      ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] } : {}),
      ...(filters?.styles?.length ? { styles: { hasSome: filters.styles } } : {}),
      ...(filters?.occasions?.length ? { occasions: { hasSome: filters.occasions } } : {}),
    },
    take: filters?.limit ?? 20,
    orderBy: { updatedAt: "desc" },
  });
  return products.map(toView);
}

export async function getWholesaleProduct(productId: string): Promise<WholesaleProductView | null> {
  const p = await getPrisma().product.findFirst({ where: { id: productId, ...WHOLESALE_WHERE } });
  return p ? toView(p) : null;
}

export async function checkAvailability(productId: string, qty: number, sku?: string) {
  const p = await getPrisma().product.findFirst({ where: { id: productId, ...WHOLESALE_WHERE } });
  if (!p) return { available: false, reason: "produto não disponível no atacado", inStock: 0, minQty: 0 };
  const inStock = availableStock(p as any, sku);
  const minQty = p.wholesaleMinQty;
  return { available: inStock >= qty && qty >= minQty, inStock, minQty, unitWholesaleBRL: wholesaleUnitPrice(p as any) };
}

export async function listCategories() {
  const products = await getPrisma().product.findMany({ where: WHOLESALE_WHERE, select: { styles: true, occasions: true } });
  const styles = new Set<string>(), occasions = new Set<string>();
  for (const p of products) { (p.styles ?? []).forEach((s) => styles.add(s)); (p.occasions ?? []).forEach((o) => occasions.add(o)); }
  return { styles: [...styles].sort(), occasions: [...occasions].sort() };
}

/** Cria uma cotação de atacado (valida via buildWholesaleQuote). */
export async function requestQuote(buyerRef: string, lines: QuoteLineInput[], ttlDays = 7) {
  const ids = [...new Set(lines.map((l) => l.productId))];
  const products = await getPrisma().product.findMany({ where: { id: { in: ids } } });
  const built = buildWholesaleQuote(products as any, lines);
  if (!built.ok) return { ok: false as const, errors: built.errors };

  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  const quote = await getPrisma().wholesaleQuote.create({
    data: { sellerTenantId: built.sellerTenantId, buyerRef, items: built.lines as any, totalBRL: built.totalBRL, expiresAt },
  });
  return { ok: true as const, quoteId: quote.id, totalBRL: built.totalBRL, lines: built.lines, expiresAt: expiresAt.toISOString() };
}

/** Fecha o pedido B2B a partir de uma cotação aberta e válida. */
export async function placeWholesaleOrder(quoteId: string, buyerRef: string) {
  const prisma = getPrisma();
  const quote = await prisma.wholesaleQuote.findUnique({ where: { id: quoteId } });
  if (!quote) return { ok: false as const, reason: "cotação não encontrada" };
  if (quote.buyerRef !== buyerRef) return { ok: false as const, reason: "cotação de outro comprador" };
  if (quote.status !== "open") return { ok: false as const, reason: `cotação ${quote.status}` };
  if (quote.expiresAt < new Date()) {
    await prisma.wholesaleQuote.update({ where: { id: quoteId }, data: { status: "expired" } });
    return { ok: false as const, reason: "cotação expirada" };
  }
  const total = Number(quote.totalBRL);
  const { commissionPct, commissionBRL, sellerNetBRL } = computeCommission(total);
  const lines = (quote.items as Array<{ productId: string; name: string; sku: string | null; qty: number }>) ?? [];

  // Tudo numa transação: cria o pedido, baixa o estoque do vendedor e grava
  // `sale_out` no razão. Re-valida estoque AGORA (pode ter mudado desde a cotação);
  // se faltar, a transação inteira faz rollback (pedido não é criado).
  try {
    const order = await prisma.$transaction(async (tx) => {
      const order = await tx.wholesaleOrder.create({
        data: { quoteId, sellerTenantId: quote.sellerTenantId, buyerRef, totalBRL: quote.totalBRL, commissionPct, commissionBRL, status: "placed" },
      });
      for (const line of lines) await consumeWholesaleStock(tx, quote.sellerTenantId, line, order.id);
      await tx.wholesaleQuote.update({ where: { id: quoteId }, data: { status: "ordered" } });
      return order;
    });
    return { ok: true as const, orderId: order.id, status: order.status, totalBRL: total, commissionPct, commissionBRL, sellerNetBRL };
  } catch (e) {
    if (e instanceof StockShortage) return { ok: false as const, reason: e.message };
    throw e;
  }
}

class StockShortage extends Error {}

/** Baixa o estoque do vendedor para uma linha do pedido B2B e grava `sale_out`. */
async function consumeWholesaleStock(
  tx: Prisma.TransactionClient, sellerTenantId: string,
  line: { productId: string; name: string; sku: string | null; qty: number }, orderId: string,
) {
  const product = await tx.product.findUnique({ where: { id: line.productId } });
  if (!product) throw new StockShortage(`produto ${line.productId} indisponível`);
  const variants = (product.variants as Array<{ sku: string; stock?: number }>) ?? [];

  if (line.sku) {
    const v = variants.find((x) => x.sku === line.sku);
    if (!v || num(v.stock) < line.qty) throw new StockShortage(`${product.name}: estoque insuficiente`);
    v.stock = num(v.stock) - line.qty;
  } else {
    if (variants.reduce((s, v) => s + num(v.stock), 0) < line.qty) throw new StockShortage(`${product.name}: estoque insuficiente`);
    let remaining = line.qty;
    for (const v of variants) { if (remaining <= 0) break; const take = Math.min(num(v.stock), remaining); v.stock = num(v.stock) - take; remaining -= take; }
  }
  await tx.product.update({ where: { id: product.id }, data: { variants: variants as any } });

  const bc = await tx.productBarcode.findFirst({
    where: { tenantId: sellerTenantId, productId: product.id, ...(line.sku ? { variantSku: line.sku } : {}) },
    select: { barcode: true },
  });
  await tx.stockMovement.create({
    data: {
      tenantId: sellerTenantId, barcode: bc?.barcode ?? "", productId: product.id,
      variantSku: line.sku ?? variants[0]?.sku ?? "", type: "sale_out", quantity: line.qty,
      refType: "wholesale_order", refId: orderId, actor: "b2b",
    },
  });
}

/**
 * Resumo de receita da plataforma (ADR-024) — cross-tenant, nível-plataforma.
 * GMV (volume transacionado), comissão total, por status, por vendedor e os
 * pedidos recentes. Consumido pelo painel platform-admin.
 */
export async function platformCommissionSummary() {
  const prisma = getPrisma();
  const orders = await prisma.wholesaleOrder.findMany({ orderBy: { createdAt: "desc" } });

  let gmvBRL = 0, commissionBRL = 0;
  const byStatus: Record<string, number> = {};
  const bySellerAgg = new Map<string, { gmvBRL: number; commissionBRL: number; orders: number }>();
  for (const o of orders) {
    const total = Number(o.totalBRL), comm = Number(o.commissionBRL);
    gmvBRL += total; commissionBRL += comm;
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    const cur = bySellerAgg.get(o.sellerTenantId) ?? { gmvBRL: 0, commissionBRL: 0, orders: 0 };
    cur.gmvBRL += total; cur.commissionBRL += comm; cur.orders += 1;
    bySellerAgg.set(o.sellerTenantId, cur);
  }

  // nomes dos vendedores
  const sellerIds = [...bySellerAgg.keys()];
  const tenants = sellerIds.length ? await prisma.tenant.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(tenants.map((t) => [t.id, t.name]));

  return {
    orders: orders.length,
    gmvBRL: round2(gmvBRL),
    commissionBRL: round2(commissionBRL),
    byStatus,
    bySeller: [...bySellerAgg.entries()].map(([id, v]) => ({
      sellerTenantId: id, sellerName: nameById.get(id) ?? id,
      orders: v.orders, gmvBRL: round2(v.gmvBRL), commissionBRL: round2(v.commissionBRL),
    })).sort((a, b) => b.commissionBRL - a.commissionBRL),
    recent: orders.slice(0, 20).map((o) => ({
      orderId: o.id, sellerName: nameById.get(o.sellerTenantId) ?? o.sellerTenantId, buyerRef: o.buyerRef,
      status: o.status, totalBRL: Number(o.totalBRL), commissionBRL: Number(o.commissionBRL), createdAt: o.createdAt.toISOString(),
    })),
  };
}

export async function trackWholesaleOrder(orderId: string, buyerRef: string) {
  const order = await getPrisma().wholesaleOrder.findUnique({ where: { id: orderId } });
  if (!order || order.buyerRef !== buyerRef) return null;
  const totalBRL = Number(order.totalBRL);
  const commissionBRL = Number(order.commissionBRL);
  return {
    orderId: order.id, status: order.status, trackingCode: order.trackingCode,
    totalBRL, commissionPct: order.commissionPct, commissionBRL, sellerNetBRL: round2(totalBRL - commissionBRL),
    createdAt: order.createdAt.toISOString(),
  };
}
