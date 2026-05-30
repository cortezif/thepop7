import type { Job } from "bullmq";
import { getPrisma, withTenant } from "@hubadvisor/db";
import { extractProductAttributes } from "@hubadvisor/agent";

type EnrichmentJobData = { tenantId: string; productId?: string; limit?: number };

/**
 * Job de enriquecimento de catálogo (padrão portado do adviser/aiExtractors).
 *
 * Pega produtos com `enrichmentStatus = pending` (ou um ID específico),
 * roda Claude vision com tool use, salva atributos como `ai_suggested`
 * (lojista ainda revisa antes de aprovar).
 *
 * Sem ANTHROPIC_API_KEY válida, o job loga e segue (degradação graciosa
 * estilo adviser).
 */
export async function catalogEnrichmentProcessor(job: Job<EnrichmentJobData>): Promise<void> {
  const { tenantId, productId, limit = 10 } = job.data;
  const prisma = getPrisma();

  await withTenant(tenantId, async (tx) => {
    const products = await tx.product.findMany({
      where: productId
        ? { id: productId }
        : { enrichmentStatus: "pending" },
      take: productId ? 1 : limit,
    });

    if (products.length === 0) {
      console.log(`[catalog-enrichment] tenant=${tenantId} — nada pendente`);
      return;
    }

    console.log(`[catalog-enrichment] tenant=${tenantId} — processando ${products.length} produtos`);

    let totalIn = 0, totalOut = 0;
    for (const p of products) {
      const media = (p.media as any) ?? {};
      const photoUrls = [media.mainPhoto, ...(media.photos ?? [])].filter(Boolean);

      const result = await extractProductAttributes({
        productName: p.name,
        description: p.description ?? undefined,
        photoUrls,
      });

      if (!result.ok) {
        console.warn(`[catalog-enrichment] ${p.externalId} — falhou: ${result.error}`);
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

      totalIn += result.usage.inputTokens;
      totalOut += result.usage.outputTokens;
      console.log(
        `[catalog-enrichment] ${p.externalId} — styles=[${a.styles.join(",")}] ocasioes=[${a.occasions.join(",")}] conf=${a.confidence.toFixed(2)}`
      );
    }

    console.log(`[catalog-enrichment] tokens in=${totalIn} out=${totalOut}`);
  });
}
