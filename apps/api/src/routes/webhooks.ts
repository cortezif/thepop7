import type { FastifyPluginAsync } from "fastify";
import { getPrisma, withTenant } from "@hubadvisor/db";
import { tokenFromAddress, fetchInstagramProfile } from "@hubadvisor/connectors";
import { handleIncomingMessage } from "../services/conversation-service.js";
import { getInstagramToken } from "../services/integration-service.js";
import { captureWhatsappInbound, captureEmailInbound } from "../services/mercadologica-service.js";
import { applyCourierWebhook } from "../services/courier-dispatch-service.js";

// Webhooks externos. GET = verification handshake (Meta). POST = evento real.
// Cada handler processa o evento ou delega ao serviço correspondente.

export const webhookRoutes: FastifyPluginAsync = async (app) => {

  // ── Meta (WhatsApp + Instagram) ─────────────────────────────────────────────
  // GET: Meta verifica a URL com hub.verify_token antes de enviar eventos.
  app.get("/meta", async (req, reply) => {
    const mode      = (req.query as any)["hub.mode"];
    const token     = (req.query as any)["hub.verify_token"];
    const challenge = (req.query as any)["hub.challenge"];
    if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      app.log.info("Meta webhook verificado ✓");
      return reply.send(challenge);
    }
    return reply.code(403).send("forbidden");
  });

  // POST: mensagem/evento real chegando do WhatsApp ou Instagram.
  app.post("/meta", async (req, reply) => {
    const body = req.body as any;
    // Confirma recebimento imediato (Meta exige 200 em < 5s)
    reply.send({ received: true });

    try {
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      // WhatsApp Cloud API
      if (value?.messaging_product === "whatsapp") {
        const msgs = value?.messages ?? [];
        // O payload traz o nome de perfil de quem mandou (value.contacts[].profile.name)
        // — usamos pra já cadastrar o cliente com nome (ADR-034).
        const waContacts = value?.contacts ?? [];
        const nameOf = (waId: string): string | undefined =>
          waContacts.find((c: any) => c?.wa_id === waId)?.profile?.name || undefined;
        for (const msg of msgs) {
          if (msg.type !== "text" && msg.type !== "image") continue;
          const from = msg.from; // E.164 sem +
          const text = msg.text?.body ?? (msg.type === "image" ? "[imagem]" : "");
          // Detectar tenant pelo número de destino
          const toPhone = value?.metadata?.display_phone_number ?? "";
          // Mercadológica (ADR-029): se o remetente é um fornecedor com cotação
          // aberta, captura a proposta (IA) em vez de acionar o atendimento.
          try {
            const captured = await captureWhatsappInbound(from, text);
            if (captured.matched) {
              app.log.info({ from, ok: (captured as any).ok }, "WA inbound capturado como cotação (RFQ)");
              continue;
            }
          } catch (e) { app.log.warn({ e: String(e) }, "captura RFQ WA falhou — segue atendimento"); }

          const tenantSlug = await resolveTenantByPhone(toPhone);
          if (!tenantSlug) { app.log.warn({ toPhone }, "nenhum tenant para o número WA"); continue; }
          await handleIncomingMessage(
            { tenantSlug, channel: "whatsapp", contact: { phone: `+${from}`, name: nameOf(from) }, text },
            app.log,
          );
        }
        // Confirmações de entrega e leitura — apenas log
        const statuses = value?.statuses ?? [];
        if (statuses.length) app.log.info({ statuses }, "WA status update");
        return;
      }

      // Instagram Messenger
      const messagingEvents = value?.messages ?? entry?.messaging ?? [];
      if (messagingEvents.length > 0) {
        for (const event of messagingEvents) {
          const senderId = event.sender?.id ?? event.from?.id;
          const text = event.message?.text ?? "";
          if (!senderId || !text) continue;
          const tenantSlug = await resolveTenantByIgAccount(entry?.id);
          if (!tenantSlug) { app.log.warn({ pageId: entry?.id }, "nenhum tenant para a página IG"); continue; }
          // Busca o nome real do perfil (Graph API) pra já cadastrar o cliente (ADR-034).
          // Não-fatal: sem token/erro, segue só com o id (IA capta o nome na conversa).
          let igName: string | undefined;
          try {
            const t = await getPrisma().tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
            const token = t ? await getInstagramToken(t.id) : null;
            if (token) {
              const prof = await fetchInstagramProfile(senderId, token);
              igName = prof?.name || prof?.username || undefined;
            }
          } catch (e) { app.log.warn({ e: String(e) }, "IG profile fetch falhou — segue sem nome"); }
          await handleIncomingMessage(
            { tenantSlug, channel: "instagram", contact: { igHandle: senderId, name: igName }, text },
            app.log,
          );
        }
        return;
      }

      app.log.info({ body }, "Meta webhook — evento não tratado");
    } catch (e) {
      app.log.error(e, "Meta webhook erro interno");
    }
  });

  // ── Mercado Pago ─────────────────────────────────────────────────────────────
  app.post("/mercadopago", async (req, reply) => {
    reply.send({ received: true });
    const body = req.body as any;
    try {
      // MP envia { action: "payment.updated", data: { id: "123456" } }
      if (body?.action !== "payment.updated" && body?.type !== "payment") return;
      const paymentId = String(body?.data?.id ?? "");
      if (!paymentId) return;

      // Consulta o pagamento na MP API (não confiamos apenas no webhook)
      const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN ?? "";
      if (!mpToken) { app.log.warn("MP webhook: MERCADOPAGO_ACCESS_TOKEN não configurado"); return; }

      const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${mpToken}` },
      });
      if (!res.ok) { app.log.warn({ paymentId, status: res.status }, "MP: falha ao buscar pagamento"); return; }
      const payment: any = await res.json();

      if (payment.status !== "approved") return;

      const orderId = payment.external_reference as string | undefined;
      if (!orderId) return;

      // Encontra o pedido e marca como pago
      const prisma = getPrisma();
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) { app.log.warn({ orderId }, "MP webhook: pedido não encontrado"); return; }
      if (order.status !== "created") { app.log.info({ orderId, status: order.status }, "MP webhook: pedido já processado"); return; }

      await withTenant(order.tenantId, async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: "paid",
            paidAt: payment.date_approved ? new Date(payment.date_approved) : new Date(),
            paymentExternalId: paymentId,
          },
        });
        await tx.domainEvent.create({
          data: {
            tenantId: order.tenantId,
            type: "order.paid",
            aggregateType: "order",
            aggregateId: orderId,
            payload: { paymentId, source: "mercadopago_webhook" } as any,
            actor: "external",
          },
        });
      });
      app.log.info({ orderId, paymentId }, "✅ Pedido marcado como pago via MP webhook");
    } catch (e) {
      app.log.error(e, "MP webhook erro interno");
    }
  });

  // ── Melhor Envio ─────────────────────────────────────────────────────────────
  app.post("/melhor-envio", async (req, reply) => {
    reply.send({ received: true });
    const body = req.body as any;
    try {
      // ME envia eventos de rastreamento com status e tracking code
      const trackingCode = body?.tracking ?? body?.tracking_code ?? body?.order?.tracking ?? "";
      const status = body?.status ?? body?.order?.status ?? "";
      if (!trackingCode || !status) { app.log.info({ body }, "ME webhook: sem tracking/status"); return; }

      const prisma = getPrisma();
      const order = await prisma.order.findFirst({ where: { trackingCode } });
      if (!order) { app.log.warn({ trackingCode }, "ME webhook: pedido não encontrado"); return; }

      const statusMap: Record<string, string> = {
        "posted": "shipped",
        "in_transit": "in_transit",
        "out_for_delivery": "out_for_delivery",
        "delivered": "delivered",
        "failed": "in_transit",
      };
      const newStatus = statusMap[status.toLowerCase()];
      if (!newStatus) return;

      await withTenant(order.tenantId, async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: newStatus as any,
            ...(newStatus === "delivered" ? { deliveredAt: new Date() } : {}),
          },
        });
        await tx.domainEvent.create({
          data: {
            tenantId: order.tenantId,
            type: `order.${newStatus}`,
            aggregateType: "order",
            aggregateId: order.id,
            payload: { trackingCode, meStatus: status } as any,
            actor: "external",
          },
        });
      });
      app.log.info({ orderId: order.id, newStatus, trackingCode }, "✅ Status do pedido atualizado via ME webhook");
    } catch (e) {
      app.log.error(e, "ME webhook erro interno");
    }
  });

  // ── E-mail inbound (Mercadológica, ADR-029) ─────────────────────────────────--
  // Provedor de inbound (Resend/Cloudflare Email Routing/SendGrid Inbound Parse)
  // posta aqui. Casa o token via plus-addressing cotacao+<token>@ e extrai por IA.
  app.post("/email-inbound", async (req, reply) => {
    reply.send({ received: true });
    const body = req.body as any;
    try {
      // Campos tolerantes a diferentes provedores
      const to = body?.to ?? body?.recipient ?? body?.envelope?.to ?? "";
      const toStr = Array.isArray(to) ? to.join(",") : String(to);
      const text = body?.text ?? body?.["body-plain"] ?? body?.stripped_text ?? body?.html ?? "";
      const token = body?.token ?? tokenFromAddress(toStr);
      if (!token || !text) { app.log.info({ toStr }, "email-inbound: sem token/texto"); return; }
      const r = await captureEmailInbound(String(token), String(text));
      app.log.info({ token, ok: (r as any).ok }, "email-inbound processado");
    } catch (e) {
      app.log.error(e, "email-inbound erro interno");
    }
  });

  // ── Courier (entregador on-demand: Lalamove/Open Delivery) — ADR-030 ──────────
  // Provedor posta mudanças de status da corrida. Casa pelo deliveryId
  // (Order.trackingCode) e atualiza o pedido. Responde 200 sempre (não reprocessa).
  app.post("/courier", async (req, reply) => {
    reply.send({ received: true });
    try {
      const r = await applyCourierWebhook(req.body);
      app.log.info({ r }, "courier webhook processado");
    } catch (e) {
      app.log.error(e, "courier webhook erro interno");
    }
  });
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Tenta descobrir o tenantSlug pelo número de telefone WA (display_phone_number).
 * Em produção: cada loja tem seu próprio número; aqui retorna o primeiro tenant
 * que tiver WHATSAPP_PHONE_NUMBER_ID configurado globalmente (multi-tenant via env). */
async function resolveTenantByPhone(_phone: string): Promise<string | null> {
  // Se há um único tenant (MVP), retorna o primeiro tenant ativo.
  // Para multi-tenant real: manter tabela phone→tenant.
  const tenant = await getPrisma().tenant.findFirst({
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
  });
  return tenant?.slug ?? null;
}

async function resolveTenantByIgAccount(_pageId: string): Promise<string | null> {
  const tenant = await getPrisma().tenant.findFirst({
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
  });
  return tenant?.slug ?? null;
}
