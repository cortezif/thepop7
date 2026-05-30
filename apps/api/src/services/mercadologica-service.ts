import crypto from "node:crypto";
import { getPrisma, withTenant } from "@hubadvisor/db";
import { getMessagingConnector, sendEmail, emailConfigured, inboundReplyTo } from "@hubadvisor/connectors";
import { parseSupplierQuote, parseSupplierQuoteFromAttachments, type QuoteAttachment } from "@hubadvisor/agent";
import { storeAttachment } from "./attachment-storage.js";
import { consolidatePrices, type EstimationMethod } from "./price-consolidation.js";

const onlyDigits = (s: string) => s.replace(/\D/g, "");

/** Casa as descrições da pesquisa com os preços extraídos pela IA. */
function matchExtracted(
  researchItems: Array<{ description: string }>,
  parsed: Array<{ description: string; unitPriceBRL: number }>,
): Array<{ item: string; unitPriceBRL: number }> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const out: Array<{ item: string; unitPriceBRL: number }> = [];
  if (researchItems.length === 0) {
    // Sem itens de referência: usa as descrições do próprio fornecedor.
    return parsed.map((p) => ({ item: p.description, unitPriceBRL: p.unitPriceBRL }));
  }
  researchItems.forEach((ri, i) => {
    const target = norm(ri.description);
    let hit = parsed.find((p) => { const n = norm(p.description); return n && (target.includes(n) || n.includes(target)); });
    if (!hit && parsed.length === researchItems.length) hit = parsed[i];
    if (!hit && researchItems.length === 1 && parsed.length === 1) hit = parsed[0];
    if (hit && hit.unitPriceBRL > 0) out.push({ item: ri.description, unitPriceBRL: hit.unitPriceBRL });
  });
  return out;
}

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
    const itemsTxt = (research.items as any[]).map((i) => `• ${i.description}${i.quantity ? ` (${i.quantity})` : ""}`).join("\n");
    const body = `Olá! ${research.title}\n\nGostaríamos da sua cotação para:\n${itemsTxt}\n\nResponda pelo link (prazo ${research.deadlineDays} dias): ${link}`;
    const vias: string[] = [];

    if (inv.phone) {
      try {
        await messaging.send({ tenantId, conversationId: `rfq-${inv.id}`, type: "text", text: body, to: inv.phone, channel: "whatsapp" });
        vias.push("whatsapp");
      } catch { /* segue — link continua disponível */ }
    }
    if (inv.email && emailConfigured()) {
      const r = await sendEmail({
        to: inv.email,
        subject: `Pedido de cotação — ${research.title}`,
        text: `${body}\n\nVocê também pode responder este e-mail informando os preços.`,
        replyTo: inboundReplyTo(inv.token), // captura inbound por e-mail (plus-addressing)
      });
      if (r.ok) vias.push("e-mail");
    }

    await prisma.priceResearchInvite.update({
      where: { id: inv.id },
      data: { state: "enviado", sentAt: new Date(), attempts: { increment: 1 } },
    });
    links.push({ supplierName: inv.supplierName, link, sentVia: vias.length ? vias.join(" + ") : "link (encaminhe manualmente)" });
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

// ── Extração por IA + captura inbound (WhatsApp / e-mail / texto colado) ────────

type ExtractContext = {
  tenantId: string;
  researchId?: string | null;
  inviteId?: string | null;
  supplierId?: string | null;
  supplierName: string;
  origin: "ia" | "whatsapp-inbound" | "email-inbound";
};

/**
 * Núcleo da captura por IA: lê o texto livre do fornecedor (WhatsApp/e-mail/colado),
 * extrai preço(s) + condições via Claude (parseSupplierQuote), casa com os itens da
 * pesquisa e grava cotações PENDENTES (aprovação humana antes de entrar no comparativo).
 */
export async function extractAndRecordQuotes(ctx: ExtractContext, rawText: string) {
  const prisma = getPrisma();
  let researchItems: Array<{ description: string }> = [];
  if (ctx.researchId) {
    const r = await prisma.priceResearch.findFirst({ where: { id: ctx.researchId, tenantId: ctx.tenantId } });
    researchItems = (r?.items as any[] | undefined)?.map((i) => ({ description: i.description })) ?? [];
  }

  const parsed = await parseSupplierQuote(rawText, {
    itemsRequested: researchItems.map((i) => i.description).join("; ") || undefined,
  });
  if (!parsed.ok) return { ok: false as const, reason: `IA não extraiu: ${parsed.error}` };

  const details = {
    leadTimeDays: parsed.quote.leadTimeDays ?? undefined,
    paymentTerms: parsed.quote.paymentTerms ?? undefined,
    confidence: parsed.quote.confidence,
    extraidoPor: "claude",
    raw: rawText.slice(0, 2000),
  };

  const matched = matchExtracted(researchItems, parsed.quote.items.map((i) => ({ description: i.description, unitPriceBRL: i.unitPriceBRL })));
  if (matched.length === 0) return { ok: false as const, reason: "nenhum preço reconhecido no texto" };

  const ids: string[] = [];
  for (const m of matched) {
    const q = await prisma.priceQuote.create({
      data: {
        tenantId: ctx.tenantId, researchId: ctx.researchId ?? null, inviteId: ctx.inviteId ?? null,
        supplierId: ctx.supplierId ?? null, supplierName: ctx.supplierName,
        item: m.item, unitPriceBRL: m.unitPriceBRL, quantity: 1,
        origin: ctx.origin, details: details as any,
      },
    });
    ids.push(q.id);
  }
  return { ok: true as const, quoteIds: ids, count: ids.length, details };
}

/** Rota do operador: cola o texto da proposta → IA extrai → cotações pendentes. */
export async function extractQuoteFromText(tenantId: string, input: {
  researchId?: string; supplierId?: string; supplierName: string; text: string;
}) {
  return extractAndRecordQuotes(
    { tenantId, researchId: input.researchId ?? null, supplierId: input.supplierId ?? null, supplierName: input.supplierName, origin: "ia" },
    input.text,
  );
}

/** Extrai cotação de ANEXOS (PDF/imagem/CSV) → cotações pendentes. */
export async function extractQuoteFromAttachments(tenantId: string, input: {
  researchId?: string; supplierId?: string; supplierName: string; attachments: QuoteAttachment[];
}) {
  const prisma = getPrisma();
  let researchItems: Array<{ description: string }> = [];
  if (input.researchId) {
    const r = await prisma.priceResearch.findFirst({ where: { id: input.researchId, tenantId } });
    researchItems = (r?.items as any[] | undefined)?.map((i) => ({ description: i.description })) ?? [];
  }
  const parsed = await parseSupplierQuoteFromAttachments(input.attachments, {
    itemsRequested: researchItems.map((i) => i.description).join("; ") || undefined,
  });
  if (!parsed.ok) return { ok: false as const, reason: `IA não extraiu do anexo: ${parsed.error}` };

  // Persiste os anexos (auditável) e referencia nas cotações geradas.
  const attachmentIds: string[] = [];
  for (const a of input.attachments) {
    try {
      const stored = await storeAttachment({ tenantId, researchId: input.researchId ?? null, fileName: a.fileName, mimeType: a.mimeType, dataBase64: a.dataBase64 });
      attachmentIds.push(stored.id);
    } catch { /* falha de storage não impede a cotação */ }
  }

  const details = {
    leadTimeDays: parsed.quote.leadTimeDays ?? undefined,
    paymentTerms: parsed.quote.paymentTerms ?? undefined,
    confidence: parsed.quote.confidence, extraidoPor: "claude", fonte: "anexo",
    attachmentIds,
  };
  const matched = matchExtracted(researchItems, parsed.quote.items.map((i) => ({ description: i.description, unitPriceBRL: i.unitPriceBRL })));
  if (matched.length === 0) return { ok: false as const, reason: "nenhum preço reconhecido no anexo" };

  const ids: string[] = [];
  for (const m of matched) {
    const q = await prisma.priceQuote.create({
      data: {
        tenantId, researchId: input.researchId ?? null, supplierId: input.supplierId ?? null,
        supplierName: input.supplierName, item: m.item, unitPriceBRL: m.unitPriceBRL, quantity: 1,
        origin: "ia", details: details as any,
      },
    });
    ids.push(q.id);
  }
  return { ok: true as const, quoteIds: ids, count: ids.length };
}

/** Acha um convite aguardando resposta pelo telefone do remetente (WhatsApp inbound). */
async function findOpenInviteByPhone(phone: string) {
  const prisma = getPrisma();
  const digits = onlyDigits(phone);
  if (!digits) return null;
  const candidates = await prisma.priceResearchInvite.findMany({
    where: { phone: { not: null }, state: { in: ["enviado", "reenviado"] } },
    orderBy: { sentAt: "desc" }, take: 50,
  });
  return candidates.find((c) => onlyDigits(c.phone ?? "").endsWith(digits.slice(-10))) ?? null;
}

/**
 * Captura inbound por WhatsApp: chamada pelo webhook Meta quando o remetente casa
 * com um convite de cotação aberto. Retorna matched=false se não for um fornecedor
 * em cotação (aí o webhook segue o fluxo normal de atendimento).
 */
export async function captureWhatsappInbound(phone: string, text: string) {
  const prisma = getPrisma();
  const invite = await findOpenInviteByPhone(phone);
  if (!invite) return { matched: false as const };
  const r = await extractAndRecordQuotes(
    { tenantId: invite.tenantId, researchId: invite.researchId, inviteId: invite.id, supplierId: invite.supplierId, supplierName: invite.supplierName, origin: "whatsapp-inbound" },
    text,
  );
  await prisma.priceResearchInvite.update({
    where: { id: invite.id },
    data: r.ok ? { state: "respondido", respondedAt: new Date() } : { state: "recebimento-confirmado" as any, respondedAt: new Date() },
  });
  return { matched: true as const, ...r };
}

/** Captura inbound por e-mail (handler do /webhooks/email-inbound), via token plus-address. */
export async function captureEmailInbound(token: string, text: string) {
  const prisma = getPrisma();
  const invite = await prisma.priceResearchInvite.findUnique({ where: { token } });
  if (!invite) return { ok: false as const, reason: "convite não encontrado" };
  const r = await extractAndRecordQuotes(
    { tenantId: invite.tenantId, researchId: invite.researchId, inviteId: invite.id, supplierId: invite.supplierId, supplierName: invite.supplierName, origin: "email-inbound" },
    text,
  );
  await prisma.priceResearchInvite.update({
    where: { id: invite.id }, data: { state: "respondido", respondedAt: new Date() },
  });
  return r;
}

/**
 * Reenvio/cobrança automática (cron): convites enviados/reenviados além do prazo,
 * sem resposta. Reenvia até 3 tentativas; depois marca "sem-resposta". Roda por
 * todos os tenants (chamado pelo worker).
 */
export async function processResends() {
  const prisma = getPrisma();
  const open = await prisma.priceResearchInvite.findMany({
    where: { state: { in: ["enviado", "reenviado"] }, sentAt: { not: null } },
    include: { research: true },
  });
  const now = Date.now();
  let resent = 0, gaveUp = 0;
  for (const inv of open) {
    if (!inv.research) continue;
    const deadlineMs = inv.research.deadlineDays * 86_400_000;
    if (!inv.sentAt || now - inv.sentAt.getTime() < deadlineMs) continue; // ainda no prazo
    if (inv.attempts >= 3) {
      await prisma.priceResearchInvite.update({ where: { id: inv.id }, data: { state: "sem-resposta" } });
      gaveUp++;
      continue;
    }
    const link = publicQuoteLink(inv.token);
    const body = `Lembrete: ainda aguardamos sua cotação para "${inv.research.title}". Responda pelo link: ${link}`;
    if (inv.phone) {
      try { await getMessagingConnector("whatsapp").send({ tenantId: inv.tenantId, conversationId: `rfq-${inv.id}`, type: "text", text: body, to: inv.phone, channel: "whatsapp" }); } catch { /* segue */ }
    }
    if (inv.email && emailConfigured()) {
      await sendEmail({ to: inv.email, subject: `Lembrete de cotação — ${inv.research.title}`, text: body, replyTo: inboundReplyTo(inv.token) });
    }
    await prisma.priceResearchInvite.update({
      where: { id: inv.id }, data: { state: "reenviado", attempts: { increment: 1 }, sentAt: new Date() },
    });
    resent++;
  }
  return { resent, gaveUp };
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
