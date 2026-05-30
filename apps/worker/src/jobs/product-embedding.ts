import type { Job } from "bullmq";
import { getPrisma, withTenant } from "@hubadvisor/db";
import { embedDocument, productEmbeddingText, vectorToPgLiteral } from "@hubadvisor/embedding";

type ProductEmbeddingJobData = { tenantId: string; productId?: string };

/**
 * Gera/atualiza o embedding (Voyage 1024-dim) de produtos.
 * Se `productId` informado, processa apenas ele.
 * Sem productId, processa todos os produtos pendentes do tenant
 * (sem embedding OU com embedding desatualizado).
 *
 * Sem VOYAGE_API_KEY, no-op silencioso (busca degrada pra BM25/atributos).
 */
export async function productEmbeddingProcessor(job: Job<ProductEmbeddingJobData>): Promise<void> {
  const { tenantId, productId } = job.data;
  const prisma = getPrisma();

  await withTenant(tenantId, async (tx) => {
    const products = await tx.product.findMany({
      where: productId
        ? { id: productId }
        : { embeddedAt: null },
      take: productId ? 1 : 50,
    });

    if (products.length === 0) return;

    // Sem a extensão pgvector instalada, esse job vira no-op (coluna embedding
    // não existe). É detectado via tentativa de UPDATE — falha → log + skip.
    for (const p of products) {
      const text = productEmbeddingText({
        name: p.name,
        description: p.description,
        styles: p.styles,
        occasions: p.occasions,
        neckline: p.neckline,
        sheer: p.sheer,
        length: p.length,
        sleeveType: p.sleeveType,
        variants: (p.variants as any) ?? [],
      });

      const result = await embedDocument(text);
      if (!result) {
        console.log("[product-embedding] VOYAGE_API_KEY ausente — sem embedding gerado");
        return;
      }

      const literal = vectorToPgLiteral(result.embedding);
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE products SET embedding = $1::vector, "embeddedAt" = NOW() WHERE id = $2`,
          literal,
          p.id
        );
        console.log(`[product-embedding] ${p.externalId} — ${result.tokensUsed} tokens`);
      } catch (e: any) {
        if (String(e?.message).includes("vector") || String(e?.message).includes("embedding")) {
          console.warn("[product-embedding] pgvector não disponível — pulando job (busca usa atributos)");
          return;
        }
        throw e;
      }
    }
  });
}
