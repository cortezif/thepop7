import { getPrisma } from "@thepop/db";
import { embedQuery } from "@thepop/embedding";

export type ProductFilter = {
  estilo?: string[];
  ocasiao?: string[];
  tamanho?: string;
  cores?: string[];
  semDecote?: boolean;
  semTransparencia?: boolean;
  precoMax?: number;
};

export type CustomerProfile = {
  styles?: string[];
  occasions?: string[];
  avoid?: string[];
  usualSize?: string;
  favoriteColors?: string[];
};

export type ProductSearchHit = {
  id: string;
  externalId: string;
  name: string;
  priceBRL: number;
  mainPhoto?: string;
  variants: Array<{ sku: string; color?: string; size?: string; stock: number }>;
  styles: string[];
  occasions: string[];
  matchScore: number;
  matchReason: "semantic" | "filters";
  // ADR-008: composição do score de negócio (transparência/debug)
  businessScore?: number;
  scoreBreakdown?: { profile: number; margin: number; stock: number };
};

type Candidate = ProductSearchHit & {
  costBRL?: number;
  totalStock: number;
};

/**
 * Busca + recomendação ponderada (ADR-008):
 *  1. Recupera candidatos (semântica via Voyage, ou filtros + atributos)
 *  2. Re-ranqueia pelos pesos do tenant: perfil × margem × giro de estoque
 *
 * Resultado: a Maya sugere o que tem mais chance de servir a cliente E
 * o que a lojista quer girar (margem alta / estoque parado).
 */
export async function searchProducts(
  tenantId: string,
  intent: string | null,
  filters: ProductFilter,
  limit = 5,
  customerProfile: CustomerProfile = {}
): Promise<ProductSearchHit[]> {
  const prisma = getPrisma();

  // Pesos do tenant (ADR-008). Default conservador: perfil domina.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { recoMarginWeight: true, recoStockWeight: true, recoProfileWeight: true },
  });
  const weights = {
    profile: tenant?.recoProfileWeight ?? 0.5,
    margin: tenant?.recoMarginWeight ?? 0.2,
    stock: tenant?.recoStockWeight ?? 0.2,
  };

  // 1. Recupera candidatos (pega mais que o limit pra re-ranquear)
  const poolSize = Math.max(limit * 4, 15);
  let candidates: Candidate[] = [];

  if (intent && intent.trim().length >= 3) {
    const emb = await embedQuery(intent);
    if (emb) {
      try {
        candidates = await semanticCandidates(tenantId, emb.embedding, filters, poolSize);
      } catch (e: any) {
        if (!String(e?.message).includes("vector")) throw e;
      }
    }
  }
  if (candidates.length === 0) {
    candidates = await attributeCandidates(tenantId, filters, poolSize);
  }

  // 2. Re-rank ponderado de negócio
  const ranked = rerankByBusinessScore(candidates, filters, customerProfile, weights);
  return ranked.slice(0, limit);
}

// ---------- recuperação de candidatos ----------

async function semanticCandidates(
  tenantId: string, queryEmbedding: number[], filters: ProductFilter, poolSize: number
): Promise<Candidate[]> {
  const prisma = getPrisma();
  const literal = `[${queryEmbedding.join(",")}]`;
  const wheres: string[] = [`tenant_id = $1`, `active = true`, `embedding IS NOT NULL`];
  const params: unknown[] = [tenantId];
  if (filters.precoMax != null) { params.push(filters.precoMax); wheres.push(`"priceBRL" <= $${params.length}`); }
  if (filters.semDecote) wheres.push(`neckline IN ('alto', 'medio')`);
  if (filters.semTransparencia) wheres.push(`sheer = false`);

  const sql = `
    SELECT id, "externalId", name, "priceBRL", "costBRL", variants, media, styles, occasions,
           (embedding <=> $${params.length + 1}::vector) AS distance
    FROM products WHERE ${wheres.join(" AND ")}
    ORDER BY embedding <=> $${params.length + 1}::vector LIMIT $${params.length + 2}`;
  params.push(literal, poolSize);

  const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params);
  return rows.map((r) => toCandidate(r, 1 - Number(r.distance), "semantic"));
}

async function attributeCandidates(
  tenantId: string, filters: ProductFilter, poolSize: number
): Promise<Candidate[]> {
  const prisma = getPrisma();
  const products = await prisma.product.findMany({
    where: {
      tenantId, active: true,
      ...(filters.precoMax ? { priceBRL: { lte: filters.precoMax } } : {}),
      ...(filters.semDecote ? { neckline: { in: ["alto", "medio"] } } : {}),
      ...(filters.semTransparencia ? { sheer: false } : {}),
    },
    take: poolSize,
  });
  return products.map((p) => {
    let rel = 0;
    if (filters.estilo)  rel += overlapCount(p.styles, filters.estilo as any);
    if (filters.ocasiao) rel += overlapCount(p.occasions, filters.ocasiao as any);
    return toCandidate(p, rel, "filters");
  });
}

function toCandidate(p: any, relevance: number, reason: "semantic" | "filters"): Candidate {
  const variants = (p.variants ?? []) as any[];
  const totalStock = variants.reduce((s, v) => s + (v.stock ?? 0), 0);
  return {
    id: p.id, externalId: p.externalId, name: p.name, priceBRL: Number(p.priceBRL),
    mainPhoto: p.media?.mainPhoto, variants, styles: p.styles ?? [], occasions: p.occasions ?? [],
    matchScore: relevance, matchReason: reason,
    costBRL: p.costBRL != null ? Number(p.costBRL) : undefined,
    totalStock,
  };
}

// ---------- re-rank ponderado (ADR-008) ----------

function rerankByBusinessScore(
  candidates: Candidate[],
  filters: ProductFilter,
  profile: CustomerProfile,
  weights: { profile: number; margin: number; stock: number }
): ProductSearchHit[] {
  if (candidates.length === 0) return [];

  const maxStock = Math.max(1, ...candidates.map((c) => c.totalStock));

  const scored = candidates.map((c) => {
    // — perfil: match de estilo/ocasião/cor com a cliente + filtros explícitos + tamanho disponível
    const styleHits = overlapCount(c.styles, [...(profile.styles ?? []), ...(filters.estilo ?? [])]);
    const occHits   = overlapCount(c.occasions, [...(profile.occasions ?? []), ...(filters.ocasiao ?? [])]);
    const colorHits = overlapCount(
      c.variants.map((v) => v.color).filter(Boolean) as string[],
      [...(profile.favoriteColors ?? []), ...(filters.cores ?? [])]
    );
    const sizeOK = filters.tamanho || profile.usualSize
      ? c.variants.some((v) => v.size === (filters.tamanho ?? profile.usualSize) && v.stock > 0) ? 1 : 0
      : 0.5; // sem tamanho informado, neutro
    // penaliza o que a cliente evita
    const avoidPenalty = overlapCount(c.styles, profile.avoid ?? []) * 0.5;
    const profileRaw = styleHits * 1.0 + occHits * 1.0 + colorHits * 0.5 + sizeOK - avoidPenalty
      + Math.min(c.matchScore, 1) * 0.5; // incorpora relevância semântica/atributo
    const profileScore = clamp01(profileRaw / 4);

    // — margem: (preço - custo) / preço. Sem custo, assume 0.4 (neutro-baixo)
    const marginPct = c.costBRL != null && c.priceBRL > 0
      ? (c.priceBRL - c.costBRL) / c.priceBRL
      : 0.4;
    const marginScore = clamp01(marginPct);

    // — giro: mais estoque → score maior (incentiva mover parado). 0 estoque = 0.
    const stockScore = c.totalStock === 0 ? 0 : clamp01(c.totalStock / maxStock);

    const business =
      weights.profile * profileScore +
      weights.margin  * marginScore +
      weights.stock   * stockScore;

    return {
      ...stripCandidate(c),
      businessScore: Number(business.toFixed(3)),
      scoreBreakdown: {
        profile: Number(profileScore.toFixed(2)),
        margin: Number(marginScore.toFixed(2)),
        stock: Number(stockScore.toFixed(2)),
      },
    };
  });

  // Trava de segurança (ADR-008): adequação ao perfil nunca pode ser ignorada.
  // Itens com perfil ~0 vão pro fim mesmo com margem/estoque altos.
  return scored.sort((a, b) => {
    const aDead = (a.scoreBreakdown!.profile < 0.05) ? 1 : 0;
    const bDead = (b.scoreBreakdown!.profile < 0.05) ? 1 : 0;
    if (aDead !== bDead) return aDead - bDead;
    return (b.businessScore ?? 0) - (a.businessScore ?? 0);
  });
}

function stripCandidate(c: Candidate): ProductSearchHit {
  const { costBRL, totalStock, ...hit } = c;
  return hit;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function overlapCount(a: string[] | undefined, b: string[] | string | undefined): number {
  const arrA = asArray(a);
  const arrB = asArray(b);
  if (arrA.length === 0 || arrB.length === 0) return 0;
  const setB = new Set(arrB.map((x) => String(x).toLowerCase()));
  return arrA.filter((x) => setB.has(String(x).toLowerCase())).length;
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}
