import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { buildErpForTenant } from "@hubadvisor/connectors";
import { getPrisma, withTenant } from "@hubadvisor/db";
import { resolveErpCreds } from "../lib/erp.js";
import { searchProducts } from "../services/product-search.js";
import { backfillBarcodes, resolveScannedBarcode, findBarcodesByPhoto } from "../services/barcode-service.js";
import { z } from "zod";

// Mapeia uma linha de Product (banco) para o shape consumido pelo painel.
function mapProduct(p: any) {
  return {
    id: p.id,
    externalId: p.externalId,
    source: p.source ?? "erp",
    name: p.name,
    description: p.description ?? null,
    priceBRL: Number(p.priceBRL),
    costBRL: p.costBRL == null ? null : Number(p.costBRL),
    variants: ((p.variants as Array<{ sku?: string; color?: string; size?: string; stock?: number }>) ?? []),
    measurements: (p.measurements as Record<string, unknown> | null) ?? null,
    styles: p.styles ?? [],
    occasions: p.occasions ?? [],
    active: p.active,
  };
}

const VariantSchema = z.object({
  sku: z.string().min(1),
  color: z.string().optional(),
  size: z.string().optional(),
  stock: z.number().int().min(0).default(0),
});
const ProductBodySchema = z.object({
  tenantSlug: z.string().optional(),
  name: z.string().min(1, "informe o nome"),
  description: z.string().optional(),
  priceBRL: z.number().positive("preço deve ser > 0"),
  costBRL: z.number().min(0).nullable().optional(),
  variants: z.array(VariantSchema).min(1, "informe ao menos uma variante"),
  measurements: z.record(z.string(), z.any()).nullable().optional(),
  styles: z.array(z.string()).optional(),
  occasions: z.array(z.string()).optional(),
});

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  // Catálogo unificado: lê do banco (produtos do ERP sincronizados + manuais).
  // É a mesma fonte usada por busca/pedidos/atacado/enriquecimento.
  app.get("/products", async (req) => {
    const products = await getPrisma().product.findMany({
      where: { tenantId: req.auth!.tenantId, active: true },
      orderBy: [{ source: "asc" }, { createdAt: "desc" }],
    });
    return products.map(mapProduct);
  });

  // POST /catalog/products — cadastra um produto MANUAL (loja sem ERP, ou item avulso).
  app.post("/products", async (req, reply) => {
    const body = ProductBodySchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenantId = req.auth!.tenantId;
    const d = body.data;
    const created = await getPrisma().product.create({
      data: {
        tenantId,
        externalId: `manual-${randomUUID()}`,
        source: "manual",
        name: d.name,
        description: d.description ?? null,
        priceBRL: d.priceBRL,
        costBRL: d.costBRL ?? null,
        variants: d.variants as any,
        media: { mainPhoto: null, photos: [], videos: [] } as any,
        measurements: (d.measurements ?? undefined) as any,
        styles: d.styles ?? [],
        occasions: d.occasions ?? [],
        enrichmentStatus: "approved", // manual = revisado pelo lojista
      },
    });
    return mapProduct(created);
  });

  // PUT /catalog/products/:id — edita. Manual: edição total. ERP/Tray: os campos
  // centrais vêm do ERP (edite lá) — bloqueia para preservar o sync (A coexiste com B).
  app.put("/products/:id", async (req, reply) => {
    const body = ProductBodySchema.partial().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenantId = req.auth!.tenantId;
    const id = (req.params as any).id;
    const prod = await getPrisma().product.findFirst({ where: { id, tenantId } });
    if (!prod) return reply.code(404).send({ error: "produto não encontrado" });
    if (prod.source !== "manual") {
      return reply.code(409).send({ error: "produto sincronizado do ERP (Tray) — edite no ERP. Aqui dá pra ajustar só atacado e atributos de IA." });
    }
    const d = body.data;
    const updated = await getPrisma().product.update({
      where: { id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.description !== undefined ? { description: d.description ?? null } : {}),
        ...(d.priceBRL !== undefined ? { priceBRL: d.priceBRL } : {}),
        ...(d.costBRL !== undefined ? { costBRL: d.costBRL ?? null } : {}),
        ...(d.variants !== undefined ? { variants: d.variants as any } : {}),
        ...(d.measurements !== undefined ? { measurements: (d.measurements ?? undefined) as any } : {}),
        ...(d.styles !== undefined ? { styles: d.styles } : {}),
        ...(d.occasions !== undefined ? { occasions: d.occasions } : {}),
      },
    });
    return mapProduct(updated);
  });

  // DELETE /catalog/products/:id — remove do catálogo (soft delete, active=false).
  // Funciona p/ manual e ERP; o sync (upsert-only) não reativa o que foi desativado.
  app.delete("/products/:id", async (req, reply) => {
    const tenantId = req.auth!.tenantId;
    const id = (req.params as any).id;
    const prod = await getPrisma().product.findFirst({ where: { id, tenantId } });
    if (!prod) return reply.code(404).send({ error: "produto não encontrado" });
    await getPrisma().product.update({ where: { id }, data: { active: false } });
    return { ok: true };
  });

  // POST /catalog/sync — puxa o catálogo do ERP (Tray) para o banco sob demanda
  // (upsert por externalId, source=erp; NÃO toca nos manuais).
  app.post("/sync", async (req, reply) => {
    const tenantId = req.auth!.tenantId;
    const { provider, trayCreds, blingCreds, connected } = await resolveErpCreds(tenantId);
    // Sem ERP real conectado não há o que importar — e NÃO injetamos o mock
    // (senão uma loja de bolos receberia produtos de moda de demonstração).
    if (!connected) {
      const nome = provider === "bling" ? "a Bling" : "a Tray";
      return reply.code(400).send({ error: `Conecte ${nome} em Configurações antes de sincronizar — sem ERP conectado não há catálogo para importar.` });
    }
    const erp = buildErpForTenant({ trayCreds, blingCreds });
    const products = await erp.listProducts();
    let upserted = 0;
    await withTenant(tenantId, async (tx) => {
      for (const p of products) {
        await tx.product.upsert({
          where: { tenantId_externalId: { tenantId, externalId: p.externalId } },
          update: { name: p.name, description: p.description ?? null, priceBRL: p.priceBRL, costBRL: p.costBRL ?? null, variants: p.variants as any },
          create: {
            tenantId, externalId: p.externalId, source: "erp", name: p.name,
            description: p.description ?? null, priceBRL: p.priceBRL, costBRL: p.costBRL ?? null,
            variants: p.variants as any, media: { mainPhoto: p.photos[0], photos: p.photos, videos: [] } as any,
            styles: [], occasions: [],
          },
        });
        upserted++;
      }
    });
    return { ok: true as const, upserted };
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
      // Aceita URL http(s) OU data URL (foto anexada do dispositivo, base64).
      photoUrls: z.array(z.string().refine((s) => /^https?:\/\//i.test(s) || s.startsWith("data:image/"), "informe uma URL http(s) ou anexe uma imagem")).min(1, "envie ao menos uma foto"),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const r = await findBarcodesByPhoto(req.auth!.tenantId, body.data.photoUrls);
    if (!r.ok) return reply.code(422).send(r);
    return r;
  });

  app.get("/products/:id", async (req, reply) => {
    const id = (req.params as any).id;
    const { trayCreds, blingCreds } = await resolveErpCreds(req.auth!.tenantId);
    const erp = buildErpForTenant({ trayCreds, blingCreds });
    const product = await erp.getProduct(id);
    if (!product) return reply.code(404).send({ error: "not found" });
    return product;
  });
};
