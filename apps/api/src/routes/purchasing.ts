import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPrisma, withTenant } from "@thepop/db";
import { detectReorder, openPurchaseRequest, recordQuote, rankQuotes, suggestPurchaseClose, getReceivingList, confirmReceiving } from "../services/purchasing-service.js";

async function tid(slug: string) {
  const t = await getPrisma().tenant.findUnique({ where: { slug } });
  return t?.id ?? null;
}

export const purchasingRoutes: FastifyPluginAsync = async (app) => {
  // GET /purchasing/reorder?tenantSlug= — produtos no ponto de pedido
  app.get("/reorder", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return detectReorder(id);
  });

  // POST /purchasing/request — abre requisição + gera mensagens de cotação
  app.post("/request", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      items: z.array(z.object({ sku: z.string().optional(), description: z.string(), quantity: z.number() })),
      reason: z.string().optional(),
      supplierIds: z.array(z.string()).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const id = await tid(body.data.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return openPurchaseRequest(id, body.data);
  });

  // POST /purchasing/quote — registra resposta de fornecedor (parser IA)
  app.post("/quote", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      requestId: z.string(),
      supplierId: z.string(),
      supplierMessage: z.string().min(1),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const id = await tid(body.data.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return recordQuote(id, body.data);
  });

  // GET /purchasing/rank?tenantSlug=&requestId= — ranqueia cotações
  app.get("/rank", async (req, reply) => {
    const q = req.query as any;
    const id = await tid(q.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return rankQuotes(id, q.requestId);
  });

  // GET /purchasing/requests/:id/close-message?tenantSlug= — co-piloto: msg de fechamento ao fornecedor recomendado
  app.get("/requests/:id/close-message", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return suggestPurchaseClose(id, (req.params as any).id);
  });

  // GET /purchasing/requests/:id/receiving?tenantSlug= — itens esperados + código de barras
  app.get("/requests/:id/receiving", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    const list = await getReceivingList(id, (req.params as any).id);
    if (!list) return reply.code(404).send({ error: "requisição não encontrada" });
    return list;
  });

  // POST /purchasing/requests/:id/receive — confere a chegada (purchase_in) por scan
  app.post("/requests/:id/receive", async (req, reply) => {
    const body = z.object({ tenantSlug: z.string(), scanned: z.array(z.string()) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const id = await tid(body.data.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    const r = await confirmReceiving(id, (req.params as any).id, body.data.scanned);
    if (!r.ok) return reply.code(404).send(r);
    return r;
  });

  // GET /purchasing/requests?tenantSlug= — lista requisições + cotações (pro painel)
  app.get("/requests", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return withTenant(id, async (tx) => {
      const requests = await tx.purchaseRequest.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          quotes: {
            orderBy: { score: "desc" },
            include: { supplier: { select: { name: true } } },
          },
        },
      });
      return requests.map((r) => ({
        id: r.id,
        status: r.status,
        reason: r.reason,
        items: r.items,
        createdAt: r.createdAt,
        quotes: r.quotes.map((q) => ({
          supplier: q.supplier.name,
          totalBRL: Number(q.totalBRL),
          leadTimeDays: q.leadTimeDays,
          paymentTerms: q.paymentTerms,
          score: q.score,
          selected: q.selected,
        })),
      }));
    });
  });

  // GET /purchasing/suppliers?tenantSlug= — lista fornecedores
  app.get("/suppliers", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return withTenant(id, async (tx) =>
      tx.supplier.findMany({ select: { id: true, name: true, contactPhone: true, relationshipScore: true, avgLeadTimeDays: true } })
    );
  });
};
