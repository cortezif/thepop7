// Broadcast de promoções / campanhas (ADR-031 fase 2).
// Envia uma mensagem a um SEGMENTO de contatos por WhatsApp / e-mail / SMS,
// respeitando LGPD: exclui quem optou por sair de "marketing" (Contact.optOuts).
// Distinto de mídia paga (AdCampaign / Meta Ads).
import { getPrisma, withTenant, decryptPII, resolveTenantCredentials } from "@hubadvisor/db";
import { getMessagingConnector, getSmsConnector, sendEmail } from "@hubadvisor/connectors";
import { enterCredentials } from "@hubadvisor/shared";
import { getSmsCreds } from "./integration-service.js";

export type Channel = "whatsapp" | "email" | "sms";
export type SegmentFilter = { onlyBuyers?: boolean };

export type CampaignInput = {
  title: string;
  message: string;
  subject?: string;
  channels: Channel[];
  onlyBuyers?: boolean;
};

const VALID_CHANNELS: Channel[] = ["whatsapp", "email", "sms"];

export function sanitizeChannels(channels: unknown): Channel[] {
  if (!Array.isArray(channels)) return [];
  const out = channels.filter((c): c is Channel => VALID_CHANNELS.includes(c as Channel));
  return [...new Set(out)];
}

// Contatos elegíveis: do tenant, que NÃO optaram por sair de "marketing".
// onlyBuyers → apenas quem já tem ao menos um pedido.
// O opt-out é filtrado em JS: o Prisma `NOT { has }` exclui até arrays vazios.
async function segmentContacts(tenantId: string, filter: SegmentFilter) {
  const rows = await getPrisma().contact.findMany({
    where: {
      tenantId,
      ...(filter.onlyBuyers ? { orders: { some: {} } } : {}),
    },
    select: { id: true, name: true, phone: true, email: true, igHandle: true, optOuts: true },
  });
  return rows.filter((c) => !c.optOuts.includes("marketing"));
}

// Quantos contatos o segmento alcança, por canal disponível.
export async function previewSegment(tenantId: string, filter: SegmentFilter) {
  const contacts = await segmentContacts(tenantId, filter);
  let withPhone = 0, withEmail = 0;
  for (const c of contacts) {
    if (c.phone) withPhone++;
    if (c.email) withEmail++;
  }
  return { total: contacts.length, withPhone, withEmail };
}

export async function createCampaign(tenantId: string, input: CampaignInput) {
  const channels = sanitizeChannels(input.channels);
  return withTenant(tenantId, (tx) =>
    tx.marketingCampaign.create({
      data: {
        tenantId,
        title: input.title.trim(),
        message: input.message.trim(),
        subject: input.subject?.trim() || null,
        channels,
        onlyBuyers: !!input.onlyBuyers,
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

  const contacts = await segmentContacts(tenantId, { onlyBuyers: camp.onlyBuyers });
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
