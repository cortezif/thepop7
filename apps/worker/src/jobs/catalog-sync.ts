import type { Job } from "bullmq";
import { getPrisma, withTenant } from "@thepop/db";
import { getErpConnector } from "@thepop/connectors";

type CatalogSyncJobData = { tenantId: string };

/**
 * Sincroniza o catálogo do ERP com o catálogo interno enriquecido.
 * - Importa produtos novos
 * - Atualiza preço/estoque
 * - Marca produtos pendentes de enriquecimento
 * Roda a cada 30 min ou sob demanda.
 */
export async function catalogSyncProcessor(job: Job<CatalogSyncJobData>): Promise<void> {
  const { tenantId } = job.data;
  const erp = getErpConnector();

  const products = await erp.listProducts();
  console.log(`[catalog-sync] tenant=${tenantId} produtos=${products.length}`);

  await withTenant(tenantId, async (tx) => {
    for (const p of products) {
      await tx.product.upsert({
        where: { tenantId_externalId: { tenantId, externalId: p.externalId } },
        update: {
          name: p.name,
          description: p.description ?? null,
          priceBRL: p.priceBRL,
          costBRL: p.costBRL ?? null,
          variants: p.variants as any,
        },
        create: {
          tenantId,
          externalId: p.externalId,
          name: p.name,
          description: p.description ?? null,
          priceBRL: p.priceBRL,
          costBRL: p.costBRL ?? null,
          variants: p.variants as any,
          media: { mainPhoto: p.photos[0], photos: p.photos, videos: [] },
          styles: [],
          occasions: [],
        },
      });
    }
  });
}
