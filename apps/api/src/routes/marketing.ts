import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  listCampaigns, createCampaign, sendCampaign, previewSegment, sanitizeChannels, sendCashbackNudges, sendWinbackAuto,
} from "../services/broadcast-service.js";
import { expiringSoon } from "../services/cashback-service.js";
import { marketingReport } from "../services/marketing-report-service.js";

// Campanhas de promoção / broadcast (ADR-031 fase 2) — WhatsApp/e-mail/SMS.
// Protegido por JWP (bloco `secure` do app).

const campaignBody = z.object({
  tenantSlug: z.string(),
  title: z.string().min(1),
  message: z.string().min(1),
  subject: z.string().nullable().optional(),
  channels: z.array(z.enum(["whatsapp", "email", "sms"])).min(1),
  audience: z.enum(["todos", "compradores", "inativos"]).optional(),
  inactiveDays: z.number().int().min(1).max(3650).optional(),
});

export const marketingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/campaigns", async (req) => listCampaigns(req.auth!.tenantId));

  app.get("/report", async (req) => marketingReport(req.auth!.tenantId));

  app.get("/segment-preview", async (req) => {
    const q = req.query as any;
    const audience = ["todos", "compradores", "inativos"].includes(q?.audience) ? q.audience : "todos";
    const inactiveDays = q?.inactiveDays ? Number(q.inactiveDays) : undefined;
    return previewSegment(req.auth!.tenantId, audience, inactiveDays);
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
      audience: body.data.audience,
      inactiveDays: body.data.inactiveDays,
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

  // Cashback a vencer — prévia (quantos clientes / quanto) e disparo manual do lembrete.
  app.get("/cashback-nudge/preview", async (req) => {
    const within = Number((req.query as any)?.withinDays) || 5;
    const groups = await expiringSoon(req.auth!.tenantId, within);
    const totalBRL = groups.reduce((s, g) => s + g.expiringBRL, 0);
    return { contacts: groups.length, totalBRL: Math.round(totalBRL * 100) / 100, withinDays: within };
  });

  app.post("/cashback-nudge", async (req) => {
    const within = Number((req.body as any)?.withinDays) || 5;
    return sendCashbackNudges(req.auth!.tenantId, within);
  });

  // Recompra automática — disparo manual (usa config da loja; throttle de 30d/cliente).
  app.post("/winback", async (req) => {
    const days = Number((req.body as any)?.inactiveDays) || undefined;
    return sendWinbackAuto(req.auth!.tenantId, days);
  });
};
