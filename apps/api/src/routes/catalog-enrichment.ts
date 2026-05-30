import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPrisma, withTenant } from "@hubadvisor/db";
import { extractProductAttributes } from "@hubadvisor/agent";

const schema = z.object({
  tenantSlug: z.string(),
  productId: z.string().optional(),
  /** Roda inline e devolve resultado, em vez de enfileirar. Útil pra demo. */
  inline: z.boolean().default(true),
});

export const catalogEnrichmentRoutes: FastifyPluginAsync = async (app) => {
  // POST /catalog/enrich
  // - Sem productId: pega todos os produtos com enrichmentStatus=pending
  // - Com productId: roda só ele
  app.post("/enrich", async (req, reply) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { tenantSlug, productId, inline } = parsed.data;
    const prisma = getPrisma();
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });

    return withTenant(tenant.id, async (tx) => {
      const products = await tx.product.findMany({
        where: productId ? { id: productId } : { enrichmentStatus: "pending" },
        take: productId ? 1 : 20,
      });

      if (!inline) {
        // TODO: enfileirar na queue "catalog-enrichment" (depende de Redis).
        // Por ora, sempre inline.
      }

      const results = [];
      for (const p of products) {
        const media = (p.media as any) ?? {};
        const photoUrls = [media.mainPhoto, ...(media.photos ?? [])].filter(Boolean);

        const result = await extractProductAttributes({
          productName: p.name,
          description: p.description ?? undefined,
          photoUrls,
        });

        if (!result.ok) {
          results.push({ id: p.id, externalId: p.externalId, ok: false, error: result.error });
          continue;
        }

        const a = result.attributes;
        await tx.product.update({
          where: { id: p.id },
          data: {
            styles: a.styles,
            occasions: a.occasions,
            neckline: a.neckline,
            sheer: a.sheer,
            length: a.length,
            sleeveType: a.sleeveType,
            enrichmentStatus: "ai_suggested",
          },
        });

        results.push({
          id: p.id,
          externalId: p.externalId,
          ok: true,
          attributes: a,
          usage: result.usage,
        });
      }

      return { tenant: tenantSlug, processed: results.length, results };
    });
  });

  // GET /catalog/enriched — lista produtos com atributos inferidos (pra revisão)
  app.get("/enriched", async (req, reply) => {
    const tenantSlug = (req.query as any).tenantSlug as string;
    if (!tenantSlug) return reply.code(400).send({ error: "tenantSlug required" });

    const prisma = getPrisma();
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });

    return withTenant(tenant.id, async (tx) => {
      return tx.product.findMany({
        where: { enrichmentStatus: { in: ["ai_suggested", "approved"] } },
        select: {
          id: true, externalId: true, name: true, priceBRL: true,
          styles: true, occasions: true, neckline: true, sheer: true,
          length: true, sleeveType: true, enrichmentStatus: true,
        },
      });
    });
  });

  // POST /catalog/approve-enrichment — lojista aprova as sugestões da IA
  app.post("/approve-enrichment", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      productId: z.string(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const prisma = getPrisma();
    const tenant = await prisma.tenant.findUnique({ where: { slug: body.data.tenantSlug } });
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });

    return withTenant(tenant.id, async (tx) => {
      await tx.product.update({
        where: { id: body.data.productId },
        data: { enrichmentStatus: "approved" },
      });
      return { ok: true };
    });
  });
};
