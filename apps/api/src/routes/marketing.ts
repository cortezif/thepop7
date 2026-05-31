import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  listCampaigns, createCampaign, sendCampaign, previewSegment, sanitizeChannels,
} from "../services/broadcast-service.js";

// Campanhas de promoção / broadcast (ADR-031 fase 2) — WhatsApp/e-mail/SMS.
// Protegido por JWP (bloco `secure` do app).

const campaignBody = z.object({
  tenantSlug: z.string(),
  title: z.string().min(1),
  message: z.string().min(1),
  subject: z.string().nullable().optional(),
  channels: z.array(z.enum(["whatsapp", "email", "sms"])).min(1),
  onlyBuyers: z.boolean().optional(),
});

export const marketingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/campaigns", async (req) => listCampaigns(req.auth!.tenantId));

  app.get("/segment-preview", async (req) => {
    const onlyBuyers = (req.query as any)?.onlyBuyers === "true";
    return previewSegment(req.auth!.tenantId, { onlyBuyers });
  });

  app.post("/campaigns", async (req, reply) => {
    const body = campaignBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const channels = sanitizeChannels(body.data.channels);
    if (channels.length === 0) return reply.code(400).send({ error: "selecione ao menos um canal" });
    return createCampaign(req.auth!.tenantId, {
      title: body.data.title,
      message: body.data.message,
      subject: body.data.subject ?? undefined,
      channels,
      onlyBuyers: body.data.onlyBuyers,
    });
  });

  app.post("/campaigns/:id/send", async (req, reply) => {
    const id = (req.params as any).id as string;
    try {
      return await sendCampaign(req.auth!.tenantId, id);
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message ?? "falha ao enviar campanha" });
    }
  });
};
