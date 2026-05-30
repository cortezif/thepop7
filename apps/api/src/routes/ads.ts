import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPrisma } from "@hubadvisor/db";
import {
  adsStatus, suggestAudiences, listCampaigns, generateCreative,
  createCampaign, setCampaignStatus, refreshInsights,
} from "../services/ads-service.js";

async function tid(slug: string) {
  const t = await getPrisma().tenant.findUnique({ where: { slug } });
  return t?.id ?? null;
}

export const adsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/status", async () => adsStatus());

  app.get("/audiences", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return suggestAudiences(id);
  });

  app.get("/campaigns", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return listCampaigns(id);
  });

  app.post("/creative", async (req, reply) => {
    const b = z.object({
      tenantSlug: z.string(), objective: z.string(), productOrOffer: z.string().min(2), audienceLabel: z.string().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.flatten() });
    const id = await tid(b.data.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return generateCreative(id, b.data);
  });

  app.post("/campaigns", async (req, reply) => {
    const b = z.object({
      tenantSlug: z.string(), name: z.string().min(1),
      objective: z.enum(["mensagens", "trafego", "vendas", "reconhecimento"]),
      dailyBudgetBRL: z.number().positive(),
      audience: z.object({ label: z.string().optional(), definition: z.record(z.any()).optional() }).optional(),
      creative: z.object({ headline: z.string().optional(), primaryText: z.string().optional(), cta: z.string().optional(), imageUrl: z.string().optional() }).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.flatten() });
    const id = await tid(b.data.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return createCampaign(id, b.data);
  });

  app.post("/campaigns/:id/status", async (req, reply) => {
    const b = z.object({ tenantSlug: z.string(), status: z.enum(["ativa", "pausada"]) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.flatten() });
    const id = await tid(b.data.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return setCampaignStatus(id, (req.params as any).id, b.data.status);
  });

  app.post("/campaigns/:id/insights", async (req, reply) => {
    const id = await tid((req.body as any)?.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return refreshInsights(id, (req.params as any).id);
  });
};
