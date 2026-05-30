import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPrisma } from "@hubadvisor/db";
import {
  listSuppliers, createSupplier, addSupplierOffer,
  createResearch, listResearches, addInvites, sendInvites,
  recordPriceQuote, listPendingQuotes, approveQuote, rejectQuote,
  consolidateResearch, closeResearch, mercadologicaPanel,
  submitPublicQuote, getPublicInvite, extractQuoteFromText, extractQuoteFromAttachments, processResends,
} from "../services/mercadologica-service.js";
import { readAttachment } from "../services/attachment-storage.js";

async function tid(slug: string) {
  const t = await getPrisma().tenant.findUnique({ where: { slug } });
  return t?.id ?? null;
}

// ── Rotas protegidas (painel do operador) ──────────────────────────────────────
export const mercadologicaRoutes: FastifyPluginAsync = async (app) => {
  // Fornecedores
  app.get("/suppliers", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return listSuppliers(id);
  });

  app.post("/suppliers", async (req, reply) => {
    const b = z.object({
      tenantSlug: z.string(), name: z.string().min(1),
      document: z.string().optional(), email: z.string().optional(), phone: z.string().optional(),
      uf: z.string().optional(), municipio: z.string().optional(),
      categories: z.array(z.string()).optional(), shareable: z.boolean().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.flatten() });
    const id = await tid(b.data.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return createSupplier(id, b.data);
  });

  app.post("/suppliers/offer", async (req, reply) => {
    const b = z.object({
      tenantSlug: z.string(), supplierId: z.string(), item: z.string().min(1),
      sku: z.string().optional(), priceBRL: z.number().positive(), unit: z.string().optional(),
      validUntil: z.string().optional(), notes: z.string().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.flatten() });
    const id = await tid(b.data.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return addSupplierOffer(id, b.data);
  });

  // Pesquisas de preço
  app.get("/researches", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return listResearches(id);
  });

  app.post("/researches", async (req, reply) => {
    const b = z.object({
      tenantSlug: z.string(), title: z.string().min(1),
      items: z.array(z.object({ description: z.string().min(1), sku: z.string().optional(), quantity: z.number().optional() })).min(1),
      method: z.enum(["media", "mediana", "menor-preco"]).optional(),
      deadlineDays: z.number().int().positive().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.flatten() });
    const id = await tid(b.data.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return createResearch(id, b.data);
  });

  app.post("/researches/:id/invites", async (req, reply) => {
    const b = z.object({
      tenantSlug: z.string(),
      invites: z.array(z.object({
        supplierId: z.string().optional(), supplierName: z.string().min(1),
        email: z.string().optional(), phone: z.string().optional(),
      })).min(1),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.flatten() });
    const id = await tid(b.data.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return addInvites(id, (req.params as any).id, b.data.invites);
  });

  app.post("/researches/:id/send", async (req, reply) => {
    const id = await tid((req.body as any)?.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return sendInvites(id, (req.params as any).id);
  });

  app.get("/researches/:id/consolidation", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    const r = await consolidateResearch(id, (req.params as any).id);
    if (!r) return reply.code(404).send({ error: "pesquisa não encontrada" });
    return r;
  });

  app.post("/researches/:id/close", async (req, reply) => {
    const id = await tid((req.body as any)?.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return closeResearch(id, (req.params as any).id);
  });

  // Cotações
  app.post("/quotes", async (req, reply) => {
    const b = z.object({
      tenantSlug: z.string(), researchId: z.string().optional(), supplierId: z.string().optional(),
      supplierName: z.string().min(1), item: z.string().min(1), unitPriceBRL: z.number().positive(),
      quantity: z.number().int().positive().optional(), details: z.record(z.any()).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.flatten() });
    const id = await tid(b.data.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return recordPriceQuote(id, b.data);
  });

  // IA extrai a proposta de um texto colado (e-mail/WhatsApp/PDF transcrito) → pendente
  app.post("/quotes/extract", async (req, reply) => {
    const b = z.object({
      tenantSlug: z.string(), supplierName: z.string().min(1), text: z.string().min(3),
      researchId: z.string().optional(), supplierId: z.string().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.flatten() });
    const id = await tid(b.data.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return extractQuoteFromText(id, b.data);
  });

  // IA extrai a proposta de ANEXOS (PDF/imagem/CSV em base64) → pendente
  app.post("/quotes/extract-file", async (req, reply) => {
    const b = z.object({
      tenantSlug: z.string(), supplierName: z.string().min(1),
      researchId: z.string().optional(), supplierId: z.string().optional(),
      attachments: z.array(z.object({
        fileName: z.string(), mimeType: z.string(), dataBase64: z.string().min(1),
      })).min(1).max(5),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.flatten() });
    const id = await tid(b.data.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return extractQuoteFromAttachments(id, b.data);
  });

  app.get("/quotes/pending", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return listPendingQuotes(id);
  });

  // Download de anexo de proposta (auditável, tenant-scoped)
  app.get("/attachments/:id", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    const att = await readAttachment(id, (req.params as any).id);
    if (!att) return reply.code(404).send({ error: "anexo não encontrado" });
    reply.header("Content-Type", att.mimeType);
    reply.header("Content-Disposition", `inline; filename="${att.fileName.replace(/"/g, "")}"`);
    return reply.send(att.data);
  });

  app.post("/quotes/:id/approve", async (req, reply) => {
    const id = await tid((req.body as any)?.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return approveQuote(id, (req.params as any).id);
  });

  app.post("/quotes/:id/reject", async (req, reply) => {
    const id = await tid((req.body as any)?.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return rejectQuote(id, (req.params as any).id, (req.body as any)?.reason);
  });

  app.get("/panel", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return mercadologicaPanel(id);
  });
};

// ── Rota de CRON (aberta, protegida por segredo): reenvio de convites ───────────
export const cronRoutes: FastifyPluginAsync = async (app) => {
  app.post("/mercadologica-resend", async (req, reply) => {
    const secret = process.env.CRON_SECRET;
    if (secret && (req.headers["x-cron-key"] ?? "") !== secret) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return processResends();
  });
};

// ── Rota PÚBLICA: resposta de cotação por token (sem auth) ──────────────────────
export const cotacaoPublicaRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:token", async (req, reply) => {
    const data = await getPublicInvite((req.params as any).token);
    if (!data) return reply.code(404).send({ error: "convite não encontrado" });
    return data;
  });

  app.post("/:token", async (req, reply) => {
    const b = z.object({
      item: z.string().min(1), unitPriceBRL: z.number().positive(),
      quantity: z.number().int().positive().optional(), details: z.record(z.any()).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.flatten() });
    const r = await submitPublicQuote((req.params as any).token, b.data);
    if (!r.ok) return reply.code(404).send(r);
    return r;
  });
};
