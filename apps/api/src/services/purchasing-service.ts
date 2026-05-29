import { getPrisma, withTenant } from "@thepop/db";
import { parseSupplierQuote, composeQuoteRequest, composePurchaseClose } from "@thepop/agent";
import { EVENTS, normalizeBarcode } from "@thepop/shared";
import { reconcilePicking } from "./picking-service.js";
import { movementByBarcode } from "./stock-movement-service.js";

/**
 * Reposição preditiva (ADR-021): detecta produtos cujo estoque disponível
 * está no/abaixo do ponto de pedido.
 *
 * Ponto de pedido = (velocidade de venda × lead time) + estoque de segurança.
 * MVP: velocidade estimada por vendas dos últimos 30 dias; lead time do tenant
 * default (7d) ou do fornecedor; estoque de segurança = 2.
 */
export async function detectReorder(tenantId: string, leadTimeDays = 7, safetyStock = 2) {
  return withTenant(tenantId, async (tx) => {
    const products = await tx.product.findMany({ where: { active: true } });
    const since = new Date(Date.now() - 30 * 86400000);

    const suggestions: Array<{ productId: string; externalId: string; name: string; stock: number; soldLast30: number; reorderPoint: number; suggestedQty: number }> = [];

    for (const p of products) {
      // Estoque total das variantes
      const variants = (p.variants as any[]) ?? [];
      const stock = variants.reduce((s, v) => s + (v.stock ?? 0), 0);

      // Vendas dos últimos 30 dias (itens de pedidos pagos+)
      const sold = await tx.orderItem.aggregate({
        where: {
          productId: p.id,
          order: { tenantId, createdAt: { gte: since }, status: { in: ["paid", "picking", "shipped", "in_transit", "delivered", "finalized"] } },
        },
        _sum: { quantity: true },
      });
      const soldLast30 = sold._sum.quantity ?? 0;
      const dailyVelocity = soldLast30 / 30;
      const reorderPoint = Math.ceil(dailyVelocity * leadTimeDays + safetyStock);

      if (stock <= reorderPoint) {
        // Quantidade sugerida: cobre ~30 dias de venda, mínimo 5
        const suggestedQty = Math.max(5, Math.ceil(dailyVelocity * 30) - stock);
        suggestions.push({ productId: p.id, externalId: p.externalId, name: p.name, stock, soldLast30, reorderPoint, suggestedQty });
      }
    }
    return suggestions;
  });
}

/** Abre uma requisição de compra + gera mensagem de cotação pra fornecedores. */
export async function openPurchaseRequest(tenantId: string, input: {
  items: Array<{ sku?: string; description: string; quantity: number }>;
  reason?: string;
  supplierIds?: string[];
}) {
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error("tenant não encontrado");

  // Cria a requisição + escolhe fornecedores na transação (rápido, sem LLM).
  const { requestId, suppliers } = await withTenant(tenantId, async (tx) => {
    const request = await tx.purchaseRequest.create({
      data: { tenantId, items: input.items as any, reason: input.reason, status: "open" },
    });
    await tx.domainEvent.create({
      data: { tenantId, type: "purchase.requested", aggregateType: "purchase_request", aggregateId: request.id, payload: { items: input.items } as any, actor: "agent" },
    });
    const suppliers = input.supplierIds?.length
      ? await tx.supplier.findMany({ where: { id: { in: input.supplierIds } } })
      : await tx.supplier.findMany({ take: 3 });
    return { requestId: request.id, suppliers };
  });

  // Gera as mensagens de cotação FORA da transação (efeito de IA, pode levar
  // segundos). Gracioso: se a Bia/LLM cair, a requisição já está salva — devolve
  // a mensagem como indisponível em vez de abortar a criação (ADR-022).
  const messages: Array<{ supplierId: string; supplierName: string; message: string; aiUnavailable?: boolean }> = [];
  for (const s of suppliers) {
    try {
      const msg = await composeQuoteRequest(
        input.items.map((i) => ({ description: i.description, quantity: i.quantity })),
        { storeName: tenant.name, supplierName: s.name, channel: s.contactEmail ? "email" : "whatsapp" }
      );
      messages.push({ supplierId: s.id, supplierName: s.name, message: msg });
    } catch {
      messages.push({ supplierId: s.id, supplierName: s.name, message: "", aiUnavailable: true });
    }
  }

  return { requestId, messages };
}

/** Recebe a resposta do fornecedor, parseia e grava a cotação. */
export async function recordQuote(tenantId: string, input: {
  requestId: string;
  supplierId: string;
  supplierMessage: string;
}) {
  const prisma = getPrisma();
  const request = await prisma.purchaseRequest.findFirst({ where: { id: input.requestId, tenantId } });
  if (!request) throw new Error("requisição não encontrada");

  // Parse (LLM) FORA da transação: não segura conexão por segundos (ADR-022).
  const itemsRequested = ((request.items as any[]) ?? []).map((i) => `${i.quantity}x ${i.description}`).join(", ");
  const parsed = await parseSupplierQuote(input.supplierMessage, { itemsRequested });

  if (!parsed.ok) {
    // Não perde a resposta do fornecedor: registra evento auditável/recuperável.
    await withTenant(tenantId, async (tx) => {
      await tx.domainEvent.create({
        data: {
          tenantId, type: "quote.parse_failed", aggregateType: "purchase_request", aggregateId: input.requestId,
          payload: { supplierId: input.supplierId, rawMessage: input.supplierMessage, error: parsed.error } as any, actor: "agent",
        },
      });
    });
    return { ok: false, error: parsed.error };
  }

  const q = parsed.quote;
  return withTenant(tenantId, async (tx) => {
    const quote = await tx.quote.create({
      data: {
        tenantId,
        requestId: input.requestId,
        supplierId: input.supplierId,
        items: q.items as any,
        totalBRL: q.totalBRL,
        leadTimeDays: q.leadTimeDays,
        paymentTerms: q.paymentTerms,
        rawMessage: input.supplierMessage,
      },
    });
    await tx.purchaseRequest.update({ where: { id: input.requestId }, data: { status: "quoted" } });
    return { ok: true, quoteId: quote.id, parsed: q };
  });
}

/**
 * Co-piloto da Bia: sugere a mensagem de fechamento ao fornecedor da cotação
 * RECOMENDADA (selecionada) de uma requisição. Read-only — não muda estado.
 */
export async function suggestPurchaseClose(tenantId: string, requestId: string) {
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error("tenant não encontrado");

  return withTenant(tenantId, async (tx) => {
    const request = await tx.purchaseRequest.findUnique({ where: { id: requestId } });
    if (!request) return { ok: false as const, error: "requisição não encontrada" };

    const quote = await tx.quote.findFirst({
      where: { requestId, selected: true },
      include: { supplier: { select: { name: true, contactEmail: true } } },
    });
    if (!quote) return { ok: false as const, error: "nenhuma cotação selecionada — ranqueie as cotações primeiro" };

    const items = ((request.items as any[]) ?? []).map((i) => ({ description: i.description, quantity: i.quantity }));
    const message = await composePurchaseClose(
      { items, totalBRL: Number(quote.totalBRL), leadTimeDays: quote.leadTimeDays, paymentTerms: quote.paymentTerms },
      { storeName: tenant.name, supplierName: quote.supplier.name, channel: quote.supplier.contactEmail ? "email" : "whatsapp" }
    );
    return { ok: true as const, supplier: quote.supplier.name, totalBRL: Number(quote.totalBRL), message };
  });
}

/**
 * Ranqueia as cotações de uma requisição. Score combina preço (menor=melhor),
 * prazo (menor=melhor) e score de relacionamento do fornecedor — pesos da ADR-021.
 */
export async function rankQuotes(tenantId: string, requestId: string) {
  return withTenant(tenantId, async (tx) => {
    const quotes = await tx.quote.findMany({
      where: { requestId },
      include: { supplier: { select: { name: true, relationshipScore: true, onTimeRate: true } } },
    });
    if (quotes.length === 0) return { ranked: [] };

    const prices = quotes.map((q) => Number(q.totalBRL));
    const leads = quotes.map((q) => q.leadTimeDays ?? 999);
    const minPrice = Math.min(...prices), maxPrice = Math.max(...prices);
    const minLead = Math.min(...leads), maxLead = Math.max(...leads);

    const norm = (v: number, min: number, max: number) => (max === min ? 1 : 1 - (v - min) / (max - min));

    const W_PRICE = 0.5, W_LEAD = 0.3, W_REL = 0.2;
    const ranked = quotes
      .map((q) => {
        const priceScore = norm(Number(q.totalBRL), minPrice, maxPrice);
        const leadScore = norm(q.leadTimeDays ?? 999, minLead, maxLead);
        const relScore = q.supplier.relationshipScore ?? 0.5;
        const score = W_PRICE * priceScore + W_LEAD * leadScore + W_REL * relScore;
        return {
          quoteId: q.id,
          supplier: q.supplier.name,
          totalBRL: Number(q.totalBRL),
          leadTimeDays: q.leadTimeDays,
          paymentTerms: q.paymentTerms,
          score: Number(score.toFixed(3)),
        };
      })
      .sort((a, b) => b.score - a.score);

    // Marca a melhor como selecionada
    if (ranked[0]) {
      await tx.quote.updateMany({ where: { requestId }, data: { selected: false } });
      await tx.quote.update({ where: { id: ranked[0].quoteId }, data: { selected: true, score: ranked[0].score } });
    }
    return { ranked, recommended: ranked[0] };
  });
}

/**
 * Conferência de recebimento (barcode): casa os itens da requisição (por SKU →
 * código de barras) com o que foi bipado na chegada da mercadoria. Reusa a
 * reconciliação do picking. Para o painel mostrar o esperado por item.
 */
export async function getReceivingList(tenantId: string, requestId: string) {
  const prisma = getPrisma();
  const reqRow = await prisma.purchaseRequest.findFirst({ where: { id: requestId, tenantId } });
  if (!reqRow) return null;
  const items = (reqRow.items as Array<{ sku?: string; description: string; quantity: number }>) ?? [];
  const skus = items.map((i) => i.sku).filter((s): s is string => !!s);
  const barcodes = skus.length
    ? await prisma.productBarcode.findMany({ where: { tenantId, variantSku: { in: skus } } })
    : [];
  const bySku = new Map(barcodes.map((b) => [b.variantSku, b.barcode]));
  return {
    requestId,
    status: reqRow.status,
    items: items.map((i) => ({
      sku: i.sku ?? null,
      description: i.description,
      quantity: i.quantity,
      barcode: i.sku ? bySku.get(i.sku) ?? null : null,
    })),
  };
}

/**
 * Confere o recebimento: registra `purchase_in` (estoque + razão) para cada
 * código bipado, reconcilia contra o esperado e, se completo, marca a requisição
 * como `received`. `refId` = requestId (rastreabilidade compra→estoque).
 */
export async function confirmReceiving(tenantId: string, requestId: string, scanned: string[]) {
  const list = await getReceivingList(tenantId, requestId);
  if (!list) return { ok: false as const, reason: "requisição não encontrada" };

  const expected = list.items
    .filter((i) => i.barcode)
    .map((i) => ({ variantSku: i.sku!, barcode: i.barcode!, quantity: i.quantity }));
  const result = reconcilePicking(expected, scanned);

  // Conta bipados por código e registra purchase_in (estoque + razão).
  const counts = new Map<string, number>();
  for (const raw of scanned) { const b = normalizeBarcode(raw); if (b) counts.set(b, (counts.get(b) ?? 0) + 1); }
  const recorded: string[] = [];
  for (const [barcode, qty] of counts) {
    try {
      await movementByBarcode(tenantId, { barcode, type: "purchase_in", quantity: qty, refType: "purchase_request", refId: requestId });
      recorded.push(barcode);
    } catch { /* código não cadastrado: ignora (vira "extra" no reconcile) */ }
  }

  if (result.complete) {
    await withTenant(tenantId, async (tx) => {
      await tx.purchaseRequest.update({ where: { id: requestId }, data: { status: "received", closedAt: new Date() } });
      await tx.domainEvent.create({
        data: { tenantId, type: "purchase.received", aggregateType: "purchase_request", aggregateId: requestId, payload: { recorded: recorded.length } as any, actor: "operator" },
      });
    });
  }
  return { ok: true as const, ...result, recorded: recorded.length };
}
