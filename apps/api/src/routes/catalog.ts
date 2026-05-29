import type { FastifyPluginAsync } from "fastify";
import { buildErpForTenant } from "@thepop/connectors";
import { getPrisma, getTrayCreds } from "@thepop/db";
import { searchProducts } from "../services/product-search.js";

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

  app.get("/products/:id", async (req, reply) => {
    const id = (req.params as any).id;
    const erp = buildErpForTenant({ trayCreds: await getTrayCreds(req.auth!.tenantId) });
    const product = await erp.getProduct(id);
    if (!product) return reply.code(404).send({ error: "not found" });
    return product;
  });
};
