// Broadcast de promoções / campanhas (ADR-031 fase 2).
// Envia uma mensagem a um SEGMENTO de contatos por WhatsApp / e-mail / SMS,
// respeitando LGPD: exclui quem optou por sair de "marketing" (Contact.optOuts).
// Distinto de mídia paga (AdCampaign / Meta Ads).
import { getPrisma, withTenant, decryptPII, resolveTenantCredentials } from "@hubadvisor/db";
import { getMessagingConnector, getSmsConnector, sendEmail } from "@hubadvisor/connectors";
import { enterCredentials } from "@hubadvisor/shared";
import { getSmsCreds } from "./integration-service.js";
import { expiringSoon, markNudged } from "./cashback-service.js";

export type Channel = "whatsapp" | "email" | "sms";
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
  let sentWhatsapp = 0, sentEmail = 0, sentSms = 0, skipped = 0;

  for (const c of contacts) {
    const phone = decryptPII(c.phone);
    const email = decryptPII(c.email);
    let anySent = false;

    if (channels.includes("whatsapp") && phone) {
      try {
        await getMessagingConnector("whatsapp").send({
          tenantId, conversationId: `camp-${camp.id}`, type: "text",
          text: camp.message, to: phone, channel: "whatsapp",
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
  return updated;
}

/** Roda o nudge de cashback para todas as lojas com cashback ativo (cron). */
export async function runCashbackNudgesAllTenants(withinDays = 5) {
  const tenants = await getPrisma().tenant.findMany({ where: { cashbackEnabled: true }, select: { id: true } });
  let contacts = 0, sentWhatsapp = 0, sentEmail = 0, sentSms = 0;
  for (const t of tenants) {
    const r = await sendCashbackNudges(t.id, withinDays);
    contacts += r.contacts; sentWhatsapp += r.sentWhatsapp; sentEmail += r.sentEmail; sentSms += r.sentSms;
  }
  return { tenants: tenants.length, contacts, sentWhatsapp, sentEmail, sentSms };
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
  if (groups.length === 0) return { contacts: 0, sentWhatsapp: 0, sentEmail: 0, sentSms: 0, skipped: 0 };

  enterCredentials(await resolveTenantCredentials(tenantId));
  const smsCreds = (await getSmsCreds(tenantId)) ?? undefined;
  const prisma = getPrisma();

  let sentWhatsapp = 0, sentEmail = 0, sentSms = 0, skipped = 0, reached = 0;
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
        await getMessagingConnector("whatsapp").send({
          tenantId, conversationId: `cashback-nudge-${g.contactId}`, type: "text", text, to: phone, channel: "whatsapp",
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
  return { contacts: reached, sentWhatsapp, sentEmail, sentSms, skipped };
}
