import type { FastifyPluginAsync } from "fastify";
import { buildErpForTenant } from "@hubadvisor/connectors";
import { getPrisma, getTrayCreds } from "@hubadvisor/db";
import { searchProducts } from "../services/product-search.js";
import { backfillBarcodes, resolveScannedBarcode, findBarcodesByPhoto } from "../services/barcode-service.js";
import { z } from "zod";

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  app.get("/products", async (req) => {
    const tenantId = req.auth!.tenantId;
    const erp = buildErpForTenant({ trayCreds: await getTrayCreds(tenantId) });
    return erp.listProducts();
  });

  // GET /catalog/recommend?tenantSlug=&estilo=&ocasiao=&tamanho= — debug do recomendador (ADR-008)
  // Mostra o score ponderado (perfil × margem × estoque) por produto.
  app.get("/recommend", async (req, reply) => {
    const q = req.query as any;
    const tenant = await getPrisma().tenant.findUnique({ where: { slug: q.tenantSlug } });
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    const filters = {
      estilo: q.estilo ? String(q.estilo).split(",") : undefined,
      ocasiao: q.ocasiao ? String(q.ocasiao).split(",") : undefined,
      tamanho: q.tamanho,
    };
    const intent = [filters.estilo, filters.ocasiao].flat().filter(Boolean).join(" ");
    const hits = await searchProducts(tenant.id, intent || null, filters, 10);
    return {
      pesos: { perfil: tenant.recoProfileWeight, margem: tenant.recoMarginWeight, estoque: tenant.recoStockWeight },
      resultados: hits.map((h) => ({
        produto: h.name, score: h.businessScore, breakdown: h.scoreBreakdown,
        preco: h.priceBRL, estoque: h.variants.reduce((s, v) => s + v.stock, 0),
      })),
    };
  });

  // GET /catalog/wholesale — produtos internos + config de atacado (ADR-024)
  app.get("/wholesale", async (req) => {
    const products = await getPrisma().product.findMany({
      where: { tenantId: req.auth!.tenantId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, externalId: true, name: true, priceBRL: true, variants: true, wholesaleEnabled: true, wholesalePriceBRL: true, wholesaleMinQty: true },
    });
    return products.map((p) => ({
      id: p.id, externalId: p.externalId, name: p.name, priceBRL: Number(p.priceBRL),
      stock: ((p.variants as Array<{ stock?: number }>) ?? []).reduce((s, v) => s + (Number(v.stock) || 0), 0),
      wholesaleEnabled: p.wholesaleEnabled,
      wholesalePriceBRL: p.wholesalePriceBRL == null ? null : Number(p.wholesalePriceBRL),
      wholesaleMinQty: p.wholesaleMinQty,
    }));
  });

  // POST /catalog/wholesale/:id — define a exposição do produto no atacado
  app.post("/wholesale/:id", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string().optional(),
      enabled: z.boolean(),
      priceBRL: z.number().positive().nullable().optional(),
      minQty: z.number().int().positive().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenantId = req.auth!.tenantId;
    const id = (req.params as any).id;
    const prod = await getPrisma().product.findFirst({ where: { id, tenantId } });
    if (!prod) return reply.code(404).send({ error: "produto não encontrado" });
    if (body.data.enabled && body.data.priceBRL == null && prod.wholesalePriceBRL == null) {
      return reply.code(400).send({ error: "informe o preço de atacado para expor o produto" });
    }
    await getPrisma().product.update({
      where: { id },
      data: {
        wholesaleEnabled: body.data.enabled,
        ...(body.data.priceBRL !== undefined ? { wholesalePriceBRL: body.data.priceBRL } : {}),
        ...(body.data.minQty !== undefined ? { wholesaleMinQty: body.data.minQty } : {}),
      },
    });
    return { ok: true };
  });

  // POST /catalog/barcodes/backfill — atribui/sincroniza códigos (Tray/CPlug → interno)
  app.post("/barcodes/backfill", async (req) => {
    return backfillBarcodes(req.auth!.tenantId);
  });

  // GET /catalog/barcodes/resolve?code=... — código → produto+variante+FOTO
  app.get("/barcodes/resolve", async (req, reply) => {
    const code = String((req.query as any).code ?? "");
    const hit = await resolveScannedBarcode(req.auth!.tenantId, code);
    if (!hit) return reply.code(404).send({ error: "código não encontrado" });
    return hit;
  });

  // POST /catalog/barcodes/by-photo — foto da peça → códigos de barras candidatos
  app.post("/barcodes/by-photo", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string().optional(),
      photoUrls: z.array(z.string().url()).min(1, "envie ao menos uma foto"),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const r = await findBarcodesByPhoto(req.auth!.tenantId, body.data.photoUrls);
    if (!r.ok) return reply.code(422).send(r);
    return r;
  });

  app.get("/products/:id", async (req, reply) => {
    const id = (req.params as any).id;
    const erp = buildErpForTenant({ trayCreds: await getTrayCreds(req.auth!.tenantId) });
    const product = await erp.getProduct(id);
    if (!product) return reply.code(404).send({ error: "not found" });
    return product;
  });
};
