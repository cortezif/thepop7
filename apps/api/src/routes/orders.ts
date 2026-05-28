import type { FastifyPluginAsync } from "fastify";
import { getPrisma } from "@thepop/db";
import { z } from "zod";
import { listOrders, createSampleOrder, exportOrdersCSV, approveOrder } from "../services/order-service.js";

async function tid(slug: string) {
  const t = await getPrisma().tenant.findUnique({ where: { slug } });
  return t?.id ?? null;
}

export const orderRoutes: FastifyPluginAsync = async (app) => {
  // GET /orders?tenantSlug= — lista pedidos com timeline (pro painel)
  app.get("/", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return listOrders(id);
  });

  // GET /orders/export.csv?tenantSlug= — export contábil (ADR-017)
  app.get("/export.csv", async (req, reply) => {
    const slug = (req.query as any).tenantSlug;
    const t = await getPrisma().tenant.findUnique({ where: { slug } });
    if (!t) return reply.code(404).send({ error: "tenant not found" });
    const gatewayFees = ((t.policies as any)?.gatewayFees) as Record<string, number> | undefined;
    const csv = await exportOrdersCSV(t.id, gatewayFees);
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="pedidos-${slug}.csv"`);
    return csv;
  });

  // POST /orders/:id/approve — aprova pedido pendente e gera o PIX (ADR-025)
  app.post("/:id/approve", async (req, reply) => {
    const id = (req.params as any).id;
    const body = z.object({ tenantSlug: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const t = await getPrisma().tenant.findUnique({ where: { slug: body.data.tenantSlug } });
    if (!t) return reply.code(404).send({ error: "tenant not found" });
    const r = await approveOrder(t.id, id);
    if (!r.ok) return reply.code(400).send(r);
    return r;
  });

  // POST /orders/sample — cria pedido de demonstração
  app.post("/sample", async (req, reply) => {
    const id = await tid((req.body as any)?.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    try {
      return await createSampleOrder(id);
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message ?? String(e) });
    }
  });
};
