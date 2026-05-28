import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPrisma } from "@thepop/db";
import { transitionOrder } from "../services/order-service.js";
import { runPostSaleStage } from "../services/post-sale-service.js";

async function tenantId(slug: string) {
  const t = await getPrisma().tenant.findUnique({ where: { slug } });
  return t?.id ?? null;
}

export const postSaleRoutes: FastifyPluginAsync = async (app) => {
  // POST /post-sale/simulate-delivery — avança o pedido até "delivered"
  // (até os webhooks de tracking reais; simula a entrega pra testar pós-venda)
  app.post("/simulate-delivery", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      orderId: z.string(),
      deliveredTo: z.string().default("destinatário"),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const tid = await tenantId(body.data.tenantSlug);
    if (!tid) return reply.code(404).send({ error: "tenant not found" });

    // Avança pela máquina de estados: paid → picking → shipped → in_transit → delivered
    const path = ["paid", "picking", "shipped", "in_transit", "delivered"] as const;
    const results: string[] = [];
    for (const status of path) {
      try {
        await transitionOrder(tid, body.data.orderId, status,
          status === "delivered" ? { deliveredTo: body.data.deliveredTo } : undefined);
        results.push(status);
      } catch (e: any) {
        // Pode já estar além de algum estado — ignora transição inválida e segue
        results.push(`${status}:skip`);
      }
    }
    return { ok: true, transitions: results };
  });

  // POST /post-sale/trigger — dispara um marco (d1/d7/d14/d30) manualmente
  app.post("/trigger", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      orderId: z.string(),
      stage: z.enum(["d1", "d7", "d14", "d30"]),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const tid = await tenantId(body.data.tenantSlug);
    if (!tid) return reply.code(404).send({ error: "tenant not found" });

    try {
      const r = await runPostSaleStage(tid, body.data.orderId, body.data.stage);
      return r;
    } catch (e: any) {
      app.log.error(e, "post-sale trigger failed");
      return reply.code(500).send({ error: e?.message ?? String(e) });
    }
  });
};
