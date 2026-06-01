// Broadcast de promoções / campanhas (ADR-031 fase 2).
// Envia uma mensagem a um SEGMENTO de contatos por WhatsApp / e-mail / SMS,
// respeitando LGPD: exclui quem optou por sair de "marketing" (Contact.optOuts).
// Distinto de mídia paga (AdCampaign / Meta Ads).
import { getPrisma, withTenant, decryptPII, resolveTenantCredentials } from "@hubadvisor/db";
import { getMessagingConnector, getSmsConnector, sendEmail } from "@hubadvisor/connectors";
import { enterCredentials, waCostBRL, type WaCategory } from "@hubadvisor/shared";
import { getSmsCreds } from "./integration-service.js";
import { expiringSoon, markNudged, cashbackHintFor } from "./cashback-service.js";

export type Channel = "whatsapp" | "email" | "sms";

/**
 * Envia uma mensagem proativa por WhatsApp. Disparos proativos quase sempre
 * caem FORA da janela de 24h — e aí a Meta só aceita TEMPLATE aprovado. Se o
 * template do fluxo estiver configurado (env), envia como template (pago);
 * senão cai em texto (entregue apenas se a janela do cliente estiver aberta).
 * Devolve o custo estimado (BRL) da mensagem para agregação/visibilidade.
 */
async function sendWhatsappProactive(opts: {
  tenantId: string; conversationId: string; to: string; text: string;
  templateEnv: string; intent: WaCategory;
}): Promise<number> {
  const template = process.env[opts.templateEnv]?.trim() || undefined;
  await getMessagingConnector("whatsapp").send(
    template
      ? { tenantId: opts.tenantId, conversationId: opts.conversationId, channel: "whatsapp", to: opts.to, type: "template", templateName: template, templateParams: { body: opts.text } }
      : { tenantId: opts.tenantId, conversationId: opts.conversationId, channel: "whatsapp", to: opts.to, type: "text", text: opts.text },
  );
  return waCostBRL(opts.intent);
}
export type Audience = "todos" | "compradores" | "inativos";
export type SegmentFilter = { onlyBuyers?: boolean; inactiveDays?: number; excludeOptOuts?: string[] };

export const DEFAULT_INACTIVE_DAYS = 60;

/** Traduz a audiência da campanha em filtro de segmento. */
export function filterForAudience(audience: Audience, inactiveDays?: number): SegmentFilter {
  if (audience === "compradores") return { onlyBuyers: true };
  // Recompra: inativos há N dias; respeita também o opt-out "recompra".
  if (audience === "inativos") return { inactiveDays: inactiveDays ?? DEFAULT_INACTIVE_DAYS, excludeOptOuts: ["marketing", "recompra"] };
  return {};
}

export type CampaignInput = {
  title: string;
  message: string;
  subject?: string;
  channels: Channel[];
  audience?: Audience;
  inactiveDays?: number;
};

const VALID_CHANNELS: Channel[] = ["whatsapp", "email", "sms"];

export function sanitizeChannels(channels: unknown): Channel[] {
  if (!Array.isArray(channels)) return [];
  const out = channels.filter((c): c is Channel => VALID_CHANNELS.includes(c as Channel));
  return [...new Set(out)];
}

// Contatos elegíveis: do tenant, que NÃO optaram por sair dos canais pedidos.
// onlyBuyers/inactiveDays → restringe a quem já comprou (e há quanto tempo).
// O opt-out é filtrado em JS: o Prisma `NOT { has }` exclui até arrays vazios.
async function segmentContacts(tenantId: string, filter: SegmentFilter) {
  const prisma = getPrisma();
  const needBuyers = filter.onlyBuyers || filter.inactiveDays != null;
  const rows = await prisma.contact.findMany({
    where: { tenantId, ...(needBuyers ? { orders: { some: {} } } : {}) },
    select: { id: true, name: true, phone: true, email: true, igHandle: true, optOuts: true },
  });
  const exclude = filter.excludeOptOuts ?? ["marketing"];
  let list = rows.filter((c) => !exclude.some((o) => c.optOuts.includes(o)));

  if (filter.inactiveDays != null) {
    const cutoff = new Date(Date.now() - filter.inactiveDays * 86_400_000);
    const last = await prisma.order.groupBy({
      by: ["contactId"],
      where: { tenantId, contactId: { in: list.map((c) => c.id) } },
      _max: { createdAt: true },
    });
    const lastBy = new Map(last.map((o) => [o.contactId, o._max.createdAt]));
    list = list.filter((c) => { const d = lastBy.get(c.id); return d != null && d <= cutoff; });
  }
  return list;
}

// Quantos contatos a audiência alcança, por canal disponível.
export async function previewSegment(tenantId: string, audience: Audience = "todos", inactiveDays?: number) {
  const contacts = await segmentContacts(tenantId, filterForAudience(audience, inactiveDays));
  let withPhone = 0, withEmail = 0;
  for (const c of contacts) {
    if (c.phone) withPhone++;
    if (c.email) withEmail++;
  }
  return { total: contacts.length, withPhone, withEmail };
}

export async function createCampaign(tenantId: string, input: CampaignInput) {
  const channels = sanitizeChannels(input.channels);
  const audience: Audience = input.audience ?? "todos";
  return withTenant(tenantId, (tx) =>
    tx.marketingCampaign.create({
      data: {
        tenantId,
        title: input.title.trim(),
        message: input.message.trim(),
        subject: input.subject?.trim() || null,
        channels,
        audience,
        inactiveDays: audience === "inativos" ? (input.inactiveDays ?? DEFAULT_INACTIVE_DAYS) : null,
        onlyBuyers: audience !== "todos",
      },
    }),
  );
}

export async function listCampaigns(tenantId: string) {
  return getPrisma().marketingCampaign.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

// Dispara a campanha. Idempotente por status ("enviada" não reenvia).
// Erros de envio por contato são não-fatais (try/catch) e contam como skipped.
export async function sendCampaign(tenantId: string, campaignId: string) {
  const prisma = getPrisma();
  const camp = await prisma.marketingCampaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!camp) throw new Error("campanha não encontrada");
  if (camp.status === "enviada") throw new Error("campanha já enviada");
  const channels = camp.channels as Channel[];
  if (channels.length === 0) throw new Error("campanha sem canais");

  // Contexto de credenciais por loja (WhatsApp/e-mail usam tokens do tenant).
  enterCredentials(await resolveTenantCredentials(tenantId));
  const smsCreds = (await getSmsCreds(tenantId)) ?? undefined;

  const contacts = await segmentContacts(tenantId, filterForAudience(camp.audience as Audience, camp.inactiveDays ?? undefined));
  let sentWhatsapp = 0, sentEmail = 0, sentSms = 0, skipped = 0, waCostBRLTotal = 0;

  for (const c of contacts) {
    const phone = decryptPII(c.phone);
    const email = decryptPII(c.email);
    let anySent = false;

    if (channels.includes("whatsapp") && phone) {
      try {
        waCostBRLTotal += await sendWhatsappProactive({
          tenantId, conversationId: `camp-${camp.id}`, to: phone,
          text: camp.message, templateEnv: "WA_TEMPLATE_CAMPAIGN", intent: "marketing",
        });
        sentWhatsapp++; anySent = true;
      } catch { /* não-fatal */ }
    }
    if (channels.includes("email") && email) {
      try {
        const r = await sendEmail({ to: email, subject: camp.subject ?? camp.title, text: camp.message });
        if (r.ok) { sentEmail++; anySent = true; }
      } catch { /* não-fatal */ }
    }
    if (channels.includes("sms") && phone) {
      try {
        const r = await getSmsConnector(smsCreds).send({ to: phone, text: camp.message });
        if (r.ok) { sentSms++; anySent = true; }
      } catch { /* não-fatal */ }
    }
    if (!anySent) skipped++;
  }

  const updated = await withTenant(tenantId, (tx) =>
    tx.marketingCampaign.update({
      where: { id: camp.id },
      data: {
        status: "enviada",
        recipients: contacts.length,
        sentWhatsapp, sentEmail, sentSms, skipped,
        sentAt: new Date(),
      },
    }),
  );
  return { ...updated, waCostBRL: Number(waCostBRLTotal.toFixed(4)) };
}

/** Roda o nudge de cashback para todas as lojas com cashback ativo (cron). */
export async function runCashbackNudgesAllTenants(withinDays = 5) {
  const tenants = await getPrisma().tenant.findMany({ where: { cashbackEnabled: true }, select: { id: true } });
  let contacts = 0, sentWhatsapp = 0, sentEmail = 0, sentSms = 0, waCostBRL = 0;
  for (const t of tenants) {
    const r = await sendCashbackNudges(t.id, withinDays);
    contacts += r.contacts; sentWhatsapp += r.sentWhatsapp; sentEmail += r.sentEmail; sentSms += r.sentSms; waCostBRL += r.waCostBRL;
  }
  return { tenants: tenants.length, contacts, sentWhatsapp, sentEmail, sentSms, waCostBRL: Number(waCostBRL.toFixed(4)) };
}

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function nudgeText(name: string | null, amountBRL: number, daysLeft: number): string {
  const hi = name ? `Oi, ${name.split(" ")[0]}! ` : "Oi! ";
  const prazo = daysLeft <= 0 ? "vence hoje" : daysLeft === 1 ? "vence amanhã" : `vence em ${daysLeft} dias`;
  return `${hi}Você tem ${brl(amountBRL)} de cashback que ${prazo}. Aproveite e use no seu próximo pedido antes que expire 💛`;
}

/**
 * Lembrete de expiração de cashback (ADR-031 fase 2c). Para cada cliente com
 * crédito vencendo dentro de `withinDays`, envia uma mensagem personalizada por
 * WhatsApp/SMS (telefone) e e-mail. Respeita opt-out de "marketing". Marca os
 * accruals como lembrados (não reenvia por `renudgeAfterDays`). Idempotente.
 */
export async function sendCashbackNudges(tenantId: string, withinDays = 5) {
  const groups = await expiringSoon(tenantId, withinDays);
  if (groups.length === 0) return { contacts: 0, sentWhatsapp: 0, sentEmail: 0, sentSms: 0, skipped: 0, waCostBRL: 0 };

  enterCredentials(await resolveTenantCredentials(tenantId));
  const smsCreds = (await getSmsCreds(tenantId)) ?? undefined;
  const prisma = getPrisma();

  let sentWhatsapp = 0, sentEmail = 0, sentSms = 0, skipped = 0, reached = 0, waCostBRLTotal = 0;
  const now = Date.now();

  for (const g of groups) {
    const c = await prisma.contact.findFirst({
      where: { id: g.contactId, tenantId },
      select: { name: true, phone: true, email: true, optOuts: true },
    });
    if (!c || c.optOuts.includes("marketing")) { skipped++; continue; }

    const daysLeft = Math.max(0, Math.ceil((new Date(g.soonestExpiry).getTime() - now) / 86_400_000));
    const text = nudgeText(c.name, g.expiringBRL, daysLeft);
    const phone = decryptPII(c.phone);
    const email = decryptPII(c.email);
    let anySent = false;

    if (phone) {
      try {
        waCostBRLTotal += await sendWhatsappProactive({
          tenantId, conversationId: `cashback-nudge-${g.contactId}`, to: phone,
          text, templateEnv: "WA_TEMPLATE_CASHBACK", intent: "marketing",
        });
        sentWhatsapp++; anySent = true;
      } catch { /* não-fatal */ }
      try {
        const r = await getSmsConnector(smsCreds).send({ to: phone, text });
        if (r.ok) { sentSms++; anySent = true; }
      } catch { /* não-fatal */ }
    }
    if (email) {
      try {
        const r = await sendEmail({ to: email, subject: "Seu cashback está vencendo 💛", text });
        if (r.ok) { sentEmail++; anySent = true; }
      } catch { /* não-fatal */ }
    }

    if (anySent) { reached++; await markNudged(tenantId, g.entryIds); }
    else skipped++;
  }
  return { contacts: reached, sentWhatsapp, sentEmail, sentSms, skipped, waCostBRL: Number(waCostBRLTotal.toFixed(4)) };
}

// ── Recompra automática (winback) — ADR-031 ──────────────────────────────────
const WINBACK_THROTTLE_DAYS = 30;

function winbackText(name: string | null, store: string, cashbackBRL: number): string {
  const hi = name ? `Oi, ${name.split(" ")[0]}! ` : "Oi! ";
  const credito = cashbackBRL > 0
    ? ` E você ainda tem ${brl(cashbackBRL)} de cashback esperando pra usar.`
    : "";
  return `${hi}Faz um tempinho que a gente não se vê na ${store} — sentimos sua falta 💛${credito} Bora dar uma olhada nas novidades?`;
}

/**
 * Reativação automática: para quem comprou mas está inativo há
 * `inactiveDays` (config da loja), envia uma mensagem de volta personalizada
 * (com gancho de cashback se houver), por WhatsApp/SMS/e-mail. Respeita opt-out
 * "marketing" e "recompra"; throttle de 30 dias por cliente (lastWinbackAt).
 */
export async function sendWinbackAuto(tenantId: string, inactiveDaysOverride?: number) {
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, winbackInactiveDays: true } });
  if (!tenant) return { contacts: 0, sentWhatsapp: 0, sentEmail: 0, sentSms: 0, skipped: 0, waCostBRL: 0 };
  const inactiveDays = inactiveDaysOverride ?? tenant.winbackInactiveDays;
  const now = Date.now();
  const cutoff = new Date(now - inactiveDays * 86_400_000);
  const throttle = new Date(now - WINBACK_THROTTLE_DAYS * 86_400_000);

  // Compradores ainda não contatados recentemente.
  const rows = await prisma.contact.findMany({
    where: {
      tenantId,
      orders: { some: {} },
      OR: [{ lastWinbackAt: null }, { lastWinbackAt: { lt: throttle } }],
    },
    select: { id: true, name: true, phone: true, email: true, optOuts: true },
  });
  const eligible = rows.filter((c) => !c.optOuts.includes("marketing") && !c.optOuts.includes("recompra"));
  if (eligible.length === 0) return { contacts: 0, sentWhatsapp: 0, sentEmail: 0, sentSms: 0, skipped: 0, waCostBRL: 0 };

  // Último pedido por contato → mantém só os inativos há ≥ inactiveDays.
  const last = await prisma.order.groupBy({
    by: ["contactId"], where: { tenantId, contactId: { in: eligible.map((c) => c.id) } }, _max: { createdAt: true },
  });
  const lastBy = new Map(last.map((o) => [o.contactId, o._max.createdAt]));
  const targets = eligible.filter((c) => { const d = lastBy.get(c.id); return d != null && d <= cutoff; });
  if (targets.length === 0) return { contacts: 0, sentWhatsapp: 0, sentEmail: 0, sentSms: 0, skipped: 0, waCostBRL: 0 };

  enterCredentials(await resolveTenantCredentials(tenantId));
  const smsCreds = (await getSmsCreds(tenantId)) ?? undefined;

  let sentWhatsapp = 0, sentEmail = 0, sentSms = 0, skipped = 0, reached = 0, waCostBRLTotal = 0;
  for (const c of targets) {
    const hint = await cashbackHintFor(tenantId, c.id);
    const text = winbackText(c.name, tenant.name, hint?.saldoBRL ?? 0);
    const phone = decryptPII(c.phone);
    const email = decryptPII(c.email);
    let anySent = false;

    if (phone) {
      try {
        waCostBRLTotal += await sendWhatsappProactive({
          tenantId, conversationId: `winback-${c.id}`, to: phone,
          text, templateEnv: "WA_TEMPLATE_WINBACK", intent: "marketing",
        });
        sentWhatsapp++; anySent = true;
      } catch { /* não-fatal */ }
      try {
        const r = await getSmsConnector(smsCreds).send({ to: phone, text });
        if (r.ok) { sentSms++; anySent = true; }
      } catch { /* não-fatal */ }
    }
    if (email) {
      try {
        const r = await sendEmail({ to: email, subject: `Sentimos sua falta na ${tenant.name} 💛`, text });
        if (r.ok) { sentEmail++; anySent = true; }
      } catch { /* não-fatal */ }
    }

    if (anySent) {
      reached++;
      await withTenant(tenantId, (tx) => tx.contact.update({ where: { id: c.id }, data: { lastWinbackAt: new Date() } }));
    } else skipped++;
  }
  return { contacts: reached, sentWhatsapp, sentEmail, sentSms, skipped, waCostBRL: Number(waCostBRLTotal.toFixed(4)) };
}

/** Winback automático p/ todas as lojas com a recompra ativa (cron). */
export async function runWinbackAllTenants() {
  const tenants = await getPrisma().tenant.findMany({ where: { winbackEnabled: true }, select: { id: true } });
  let contacts = 0, sentWhatsapp = 0, sentEmail = 0, sentSms = 0, waCostBRL = 0;
  for (const t of tenants) {
    const r = await sendWinbackAuto(t.id);
    contacts += r.contacts; sentWhatsapp += r.sentWhatsapp; sentEmail += r.sentEmail; sentSms += r.sentSms; waCostBRL += r.waCostBRL;
  }
  return { tenants: tenants.length, contacts, sentWhatsapp, sentEmail, sentSms, waCostBRL: Number(waCostBRL.toFixed(4)) };
}
