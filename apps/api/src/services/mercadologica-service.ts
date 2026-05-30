import crypto from "node:crypto";
import { getPrisma, withTenant } from "@thepop/db";
import { getMessagingConnector } from "@thepop/connectors";
import { consolidatePrices, type EstimationMethod } from "./price-consolidation.js";

/* ============================================================================
   Mercadológica / rede de fornecedores (ADR-029).
   Pesquisa de preços: fornecedores cadastrados ofertam preços; a loja roda uma
   pesquisa e envia cotações (RFQ) inclusive para fornecedores NÃO cadastrados,
   via link público tokenizado. Captura manual/form/WhatsApp, consolida e compara.
   ============================================================================ */

const num = (v: unknown) => (v == null ? 0 : Number(v));

// ── Fornecedores ──────────────────────────────────────────────────────────────

export async function listSuppliers(tenantId: string) {
  const prisma = getPrisma();
  const suppliers = await prisma.supplier.findMany({
    where: { tenantId, active: true },
    orderBy: { name: "asc" },
    include: { offers: { orderBy: { updatedAt: "desc" } } },
  });
  return suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    document: s.document,
    email: s.contactEmail,
    phone: s.contactPhone,
    uf: s.uf,
    municipio: s.municipio,
    shareable: s.shareable,
    categories: s.categories,
    relationshipScore: s.relationshipScore,
    avgLeadTimeDays: s.avgLeadTimeDays,
    offers: s.offers.map((o) => ({
      id: o.id, item: o.item, sku: o.sku, priceBRL: num(o.priceBRL),
      unit: o.unit, validUntil: o.validUntil?.toISOString() ?? null, notes: o.notes,
    })),
  }));
}

export async function createSupplier(tenantId: string, input: {
  name: string; document?: string; email?: string; phone?: string;
  uf?: string; municipio?: string; categories?: string[]; shareable?: boolean;
}) {
  const prisma = getPrisma();
  const s = await prisma.supplier.create({
    data: {
      tenantId, name: input.name, document: input.document ?? null,
      contactEmail: input.email ?? null, contactPhone: input.phone ?? null,
      uf: input.uf ?? null, municipio: input.municipio ?? null,
      categories: input.categories ?? [], shareable: input.shareable ?? false,
    },
  });
  return { id: s.id };
}

export async function addSupplierOffer(tenantId: string, input: {
  supplierId: string; item: string; sku?: string; priceBRL: number; unit?: string;
  validUntil?: string; notes?: string;
}) {
  const prisma = getPrisma();
  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, tenantId } });
  if (!supplier) return { ok: false as const, reason: "fornecedor não encontrado" };
  const o = await prisma.supplierOffer.create({
    data: {
      tenantId, supplierId: input.supplierId, item: input.item, sku: input.sku ?? null,
      priceBRL: input.priceBRL, unit: input.unit ?? null,
      validUntil: input.validUntil ? new Date(input.validUntil) : null, notes: input.notes ?? null,
    },
  });
  return { ok: true as const, offerId: o.id };
}

// ── Pesquisa de preços (campanha) ──────────────────────────────────────────────

export async function createResearch(tenantId: string, input: {
  title: string;
  items: Array<{ description: string; sku?: string; quantity?: number }>;
  method?: EstimationMethod; deadlineDays?: number; createdBy?: string;
}) {
  const prisma = getPrisma();
  const r = await prisma.priceResearch.create({
    data: {
      tenantId, title: input.title, items: input.items as any,
      method: input.method ?? "mediana", deadlineDays: input.deadlineDays ?? 5,
      status: "rascunho", createdBy: input.createdBy ?? null,
    },
  });
  return { id: r.id };
}

export async function listResearches(tenantId: string) {
  const prisma = getPrisma();
  const rows = await prisma.priceResearch.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: { invites: true, quotes: true },
  });
  return rows.map((r) => ({
    id: r.id, title: r.title, items: r.items, method: r.method,
    deadlineDays: r.deadlineDays, status: r.status, createdAt: r.createdAt.toISOString(),
    invitesTotal: r.invites.length,
    invitesResponded: r.invites.filter((i) => i.state === "respondido").length,
    quotesCount: r.quotes.length,
  }));
}

/** Adiciona convites (fornecedores cadastrados e/ou avulsos) a uma pesquisa. */
export async function addInvites(tenantId: string, researchId: string, invites: Array<{
  supplierId?: string; supplierName: string; email?: string; phone?: string;
}>) {
  const prisma = getPrisma();
  const research = await prisma.priceResearch.findFirst({ where: { id: researchId, tenantId } });
  if (!research) return { ok: false as const, reason: "pesquisa não encontrada" };
  const created: { token: string; supplierName: string }[] = [];
  for (const inv of invites) {
    const token = crypto.randomBytes(16).toString("hex");
    await prisma.priceResearchInvite.create({
      data: {
        researchId, tenantId, supplierId: inv.supplierId ?? null,
        supplierName: inv.supplierName, email: inv.email ?? null, phone: inv.phone ?? null,
        token, state: "pendente",
      },
    });
    created.push({ token, supplierName: inv.supplierName });
  }
  return { ok: true as const, invites: created };
}

function publicQuoteLink(token: string): string {
  const base = (process.env.APP_PUBLIC_URL ?? "").replace(/\/$/, "");
  return `${base}/cotacao/${token}`;
}

/**
 * "Envia" os convites: marca em-coleta e dispara o link público por WhatsApp
 * (quando há telefone e canal configurado). Sempre retorna os links para a loja
 * copiar/encaminhar — funciona mesmo sem provedor de e-mail configurado.
 */
export async function sendInvites(tenantId: string, researchId: string) {
  const prisma = getPrisma();
  const research = await prisma.priceResearch.findFirst({
    where: { id: researchId, tenantId }, include: { invites: true },
  });
  if (!research) return { ok: false as const, reason: "pesquisa não encontrada" };

  const links: Array<{ supplierName: string; link: string; sentVia: string }> = [];
  const messaging = getMessagingConnector("whatsapp");

  for (const inv of research.invites) {
    if (inv.state !== "pendente" && inv.state !== "reenviado") {
      links.push({ supplierName: inv.supplierName, link: publicQuoteLink(inv.token), sentVia: "já enviado" });
      continue;
    }
    const link = publicQuoteLink(inv.token);
    let sentVia = "link";
    if (inv.phone) {
      const itemsTxt = (research.items as any[]).map((i) => `• ${i.description}${i.quantity ? ` (${i.quantity})` : ""}`).join("\n");
      const text = `Olá! ${research.title}\n\nGostaríamos da sua cotação para:\n${itemsTxt}\n\nResponda pelo link (prazo ${research.deadlineDays} dias): ${link}`;
      try {
        await messaging.send({ tenantId, conversationId: `rfq-${inv.id}`, type: "text", text, to: inv.phone, channel: "whatsapp" });
        sentVia = "whatsapp";
      } catch { sentVia = "link (falha no envio — encaminhe manualmente)"; }
    }
    await prisma.priceResearchInvite.update({
      where: { id: inv.id },
      data: { state: "enviado", sentAt: new Date(), attempts: { increment: 1 } },
    });
    links.push({ supplierName: inv.supplierName, link, sentVia });
  }

  await prisma.priceResearch.update({ where: { id: researchId }, data: { status: "em-coleta" } });
  return { ok: true as const, links };
}

// ── Cotações capturadas ─────────────────────────────────────────────────────--

/** Registro manual de cotação (loja digita o preço recebido). Já aprovada. */
export async function recordPriceQuote(tenantId: string, input: {
  researchId?: string; supplierId?: string; supplierName: string;
  item: string; unitPriceBRL: number; quantity?: number; details?: Record<string, unknown>;
}) {
  const prisma = getPrisma();
  const q = await prisma.priceQuote.create({
    data: {
      tenantId, researchId: input.researchId ?? null, supplierId: input.supplierId ?? null,
      supplierName: input.supplierName, item: input.item, unitPriceBRL: input.unitPriceBRL,
      quantity: input.quantity ?? 1, origin: "manual", details: (input.details ?? null) as any,
      approvedAt: new Date(), approvedBy: "operador",
    },
  });
  return { ok: true as const, quoteId: q.id };
}

/** Resposta pública via token (formulário /cotacao/<token>). Entra PENDENTE. */
export async function submitPublicQuote(token: string, input: {
  item: string; unitPriceBRL: number; quantity?: number; details?: Record<string, unknown>;
}) {
  const prisma = getPrisma();
  const invite = await prisma.priceResearchInvite.findUnique({ where: { token } });
  if (!invite) return { ok: false as const, reason: "convite inválido" };
  const q = await prisma.priceQuote.create({
    data: {
      tenantId: invite.tenantId, researchId: invite.researchId, supplierId: invite.supplierId ?? null,
      supplierName: invite.supplierName, item: input.item, unitPriceBRL: input.unitPriceBRL,
      quantity: input.quantity ?? 1, origin: "form-web", details: (input.details ?? null) as any,
      inviteId: invite.id,
    },
  });
  await prisma.priceResearchInvite.update({
    where: { id: invite.id }, data: { state: "respondido", respondedAt: new Date() },
  });
  return { ok: true as const, quoteId: q.id };
}

/** Dados públicos do convite (para a tela /cotacao/<token>). Sem PII da loja. */
export async function getPublicInvite(token: string) {
  const prisma = getPrisma();
  const invite = await prisma.priceResearchInvite.findUnique({
    where: { token }, include: { research: true, tenant: true },
  });
  if (!invite || !invite.research) return null;
  return {
    supplierName: invite.supplierName,
    storeName: invite.tenant?.name ?? "Loja",
    title: invite.research.title,
    items: invite.research.items,
    deadlineDays: invite.research.deadlineDays,
    alreadyResponded: invite.state === "respondido",
  };
}

export async function listPendingQuotes(tenantId: string) {
  const prisma = getPrisma();
  const rows = await prisma.priceQuote.findMany({
    where: { tenantId, approvedAt: null, rejectedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((q) => ({
    id: q.id, supplierName: q.supplierName, item: q.item, unitPriceBRL: num(q.unitPriceBRL),
    quantity: q.quantity, origin: q.origin, details: q.details, createdAt: q.createdAt.toISOString(),
  }));
}

export async function approveQuote(tenantId: string, quoteId: string) {
  const prisma = getPrisma();
  const r = await prisma.priceQuote.updateMany({
    where: { id: quoteId, tenantId }, data: { approvedAt: new Date(), approvedBy: "operador" },
  });
  return { ok: r.count > 0 };
}

export async function rejectQuote(tenantId: string, quoteId: string, reason?: string) {
  const prisma = getPrisma();
  const r = await prisma.priceQuote.updateMany({
    where: { id: quoteId, tenantId },
    data: { rejectedAt: new Date(), rejectedBy: "operador", rejectReason: reason ?? null },
  });
  return { ok: r.count > 0 };
}

/**
 * Mapa comparativo + consolidação de uma pesquisa: agrupa cotações aprovadas por
 * item, calcula estatísticas (média/mediana/menor, descartes, CV) e o melhor preço.
 */
export async function consolidateResearch(tenantId: string, researchId: string) {
  const prisma = getPrisma();
  const research = await prisma.priceResearch.findFirst({
    where: { id: researchId, tenantId },
    include: { quotes: { where: { approvedAt: { not: null }, rejectedAt: null } } },
  });
  if (!research) return null;
  const method = research.method as EstimationMethod;

  // agrupa por item
  const byItem = new Map<string, typeof research.quotes>();
  for (const q of research.quotes) {
    const arr = byItem.get(q.item) ?? [];
    arr.push(q);
    byItem.set(q.item, arr);
  }

  const items = [...byItem.entries()].map(([item, quotes]) => {
    const prices = quotes.map((q) => num(q.unitPriceBRL));
    const consolidation = consolidatePrices(prices, { method });
    const cheapest = quotes.reduce((min, q) => (num(q.unitPriceBRL) < num(min.unitPriceBRL) ? q : min), quotes[0]!);
    return {
      item,
      quotes: quotes
        .map((q) => ({ supplierName: q.supplierName, unitPriceBRL: num(q.unitPriceBRL), origin: q.origin, isCheapest: q.id === cheapest.id }))
        .sort((a, b) => a.unitPriceBRL - b.unitPriceBRL),
      consolidation,
    };
  });

  return {
    researchId, title: research.title, method, status: research.status,
    items,
  };
}

export async function closeResearch(tenantId: string, researchId: string) {
  const prisma = getPrisma();
  const r = await prisma.priceResearch.updateMany({
    where: { id: researchId, tenantId }, data: { status: "encerrada" },
  });
  return { ok: r.count > 0 };
}

// ── Painel ──────────────────────────────────────────────────────────────────--

export async function mercadologicaPanel(tenantId: string) {
  const prisma = getPrisma();
  const [researches, invites, pending, suppliers] = await Promise.all([
    prisma.priceResearch.groupBy({ by: ["status"], where: { tenantId }, _count: true }),
    prisma.priceResearchInvite.groupBy({ by: ["state"], where: { tenantId }, _count: true }),
    prisma.priceQuote.count({ where: { tenantId, approvedAt: null, rejectedAt: null } }),
    prisma.supplier.count({ where: { tenantId, active: true } }),
  ]);
  const toMap = (rows: { _count: number }[], key: string) =>
    Object.fromEntries(rows.map((r: any) => [r[key], r._count]));
  return {
    researchesByStatus: toMap(researches as any, "status"),
    invitesByState: toMap(invites as any, "state"),
    pendingQuotes: pending,
    suppliers,
  };
}
