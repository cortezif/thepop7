import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  listRawMaterials, createRawMaterial, updateRawMaterial, deactivateRawMaterial,
  listBoms, createBom, updateBom, deleteBom,
} from "../services/manufacturing-service.js";
import { previewProduction, createBatch, listBatches } from "../services/production-service.js";
import { getTariff, saveTariff, quoteForTenant } from "../services/delivery-service.js";

// Fabricação (ADR-030) — CRUD de insumos/embalagens e fichas técnicas (receitas).
// Tudo protegido por JWP (registrado no bloco `secure` do app).

const materialBody = z.object({
  tenantSlug: z.string(),
  name: z.string().min(1),
  category: z.enum(["ingrediente", "embalagem"]).optional(),
  baseUnit: z.enum(["g", "kg", "ml", "L", "un"]).optional(),
  sku: z.string().nullable().optional(),
  costPerBaseUnit: z.number().min(0).optional(),
  purchaseUnit: z.string().nullable().optional(),
  purchaseQtyInBase: z.number().positive().nullable().optional(),
  stockQty: z.number().min(0).optional(),
  minStockQty: z.number().min(0).nullable().optional(),
  supplierId: z.string().nullable().optional(),
});

const bomItemSchema = z.object({
  materialId: z.string().min(1),
  quantity: z.number().positive(),
  note: z.string().nullable().optional(),
});
const bomBody = z.object({
  tenantSlug: z.string(),
  name: z.string().min(1),
  productId: z.string().nullable().optional(),
  variantSku: z.string().nullable().optional(),
  yieldQty: z.number().positive().optional(),
  yieldUnit: z.string().nullable().optional(),
  lossPct: z.number().min(0).max(100).optional(),
  notes: z.string().nullable().optional(),
  items: z.array(bomItemSchema).min(1),
});

export const manufacturingRoutes: FastifyPluginAsync = async (app) => {
  // ── Insumos / embalagens ──────────────────────────────────────────────────
  app.get("/materials", async (req) => {
    const q = req.query as any;
    return listRawMaterials(req.auth!.tenantId, {
      category: q.category || undefined,
      includeInactive: q.includeInactive === "true",
    });
  });

  app.post("/materials", async (req, reply) => {
    const body = materialBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    return createRawMaterial(req.auth!.tenantId, body.data);
  });

  app.put("/materials/:id", async (req, reply) => {
    const body = materialBody.partial({ name: true }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      return await updateRawMaterial(req.auth!.tenantId, (req.params as any).id, body.data);
    } catch (e: any) { return reply.code(404).send({ error: e?.message ?? String(e) }); }
  });

  app.delete("/materials/:id", async (req, reply) => {
    try {
      return await deactivateRawMaterial(req.auth!.tenantId, (req.params as any).id);
    } catch (e: any) { return reply.code(404).send({ error: e?.message ?? String(e) }); }
  });

  // ── Fichas técnicas (receitas) ──────────────────────────────────────────────
  app.get("/boms", async (req) => listBoms(req.auth!.tenantId));

  app.post("/boms", async (req, reply) => {
    const body = bomBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      return await createBom(req.auth!.tenantId, body.data);
    } catch (e: any) { return reply.code(400).send({ error: e?.message ?? String(e) }); }
  });

  app.put("/boms/:id", async (req, reply) => {
    const body = bomBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      return await updateBom(req.auth!.tenantId, (req.params as any).id, body.data);
    } catch (e: any) { return reply.code(400).send({ error: e?.message ?? String(e) }); }
  });

  app.delete("/boms/:id", async (req, reply) => {
    try {
      return await deleteBom(req.auth!.tenantId, (req.params as any).id);
    } catch (e: any) { return reply.code(404).send({ error: e?.message ?? String(e) }); }
  });

  // ── Produção (Fase 2) ───────────────────────────────────────────────────────
  app.get("/production", async (req) => {
    const q = req.query as any;
    return listBatches(req.auth!.tenantId, q.limit ? Number(q.limit) : undefined);
  });

  // POST /manufacturing/production/preview — plano de consumo (não persiste)
  app.post("/production/preview", async (req, reply) => {
    const body = z.object({ tenantSlug: z.string(), bomId: z.string(), quantity: z.number().positive() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      return await previewProduction(req.auth!.tenantId, body.data.bomId, body.data.quantity);
    } catch (e: any) { return reply.code(404).send({ error: e?.message ?? String(e) }); }
  });

  // POST /manufacturing/production — registra o lote (consome insumos)
  app.post("/production", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      bomId: z.string(),
      quantity: z.number().positive(),
      addToStock: z.boolean().optional(),
      note: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      return await createBatch(req.auth!.tenantId, {
        bomId: body.data.bomId, quantity: body.data.quantity,
        addToStock: body.data.addToStock, note: body.data.note ?? undefined,
      });
    } catch (e: any) { return reply.code(400).send({ error: e?.message ?? String(e) }); }
  });

  // ── Entrega própria (Fase 3) ────────────────────────────────────────────────
  app.get("/delivery/tariff", async (req) => getTariff(req.auth!.tenantId));

  app.post("/delivery/tariff", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      motoVolumeLimit: z.number().min(0),
      bands: z.array(z.object({
        modal: z.enum(["moto", "carro"]),
        maxKm: z.number().positive(),
        priceBRL: z.number().min(0),
      })),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    return saveTariff(req.auth!.tenantId, { motoVolumeLimit: body.data.motoVolumeLimit, bands: body.data.bands });
  });

  // POST /manufacturing/delivery/quote — estima a entrega (distância + volume)
  app.post("/delivery/quote", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      distanceKm: z.number().min(0),
      volume: z.number().min(0),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    return quoteForTenant(req.auth!.tenantId, body.data.distanceKm, body.data.volume);
  });
};
