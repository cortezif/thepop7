import { getPrisma, withTenant } from "@hubadvisor/db";

// Peças serializadas (ADR-035 fase 3). Cada código gerado pelo padrão da loja vira
// uma peça; daí dá pra contar estoque por tamanho e dar baixa ao vender.

export type PieceInput = {
  code: string; productId?: string | null; variantSku: string; size: string;
  sequence: number; meta?: Record<string, unknown>;
};

/** Registra as peças geradas (idempotente: ignora códigos já existentes). */
export async function registerPieces(tenantId: string, pieces: PieceInput[]): Promise<number> {
  if (pieces.length === 0) return 0;
  return withTenant(tenantId, async (tx) => {
    const r = await tx.piece.createMany({
      data: pieces.map((p) => ({
        tenantId, code: p.code, productId: p.productId ?? null, variantSku: p.variantSku,
        size: p.size, sequence: p.sequence, meta: (p.meta ?? {}) as any,
      })),
      skipDuplicates: true,
    });
    return r.count;
  });
}

/** Estoque de peças por tamanho (só em_estoque). */
export async function pieceStockBySize(tenantId: string) {
  const rows = await getPrisma().piece.groupBy({
    by: ["size"],
    where: { tenantId, status: "em_estoque" },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ size: r.size || "—", count: r._count._all }))
    .sort((a, b) => b.count - a.count);
}

/** Resumo: total em estoque, vendidas, e detalhe por tamanho. */
export async function pieceSummary(tenantId: string) {
  const [bySize, vendidas] = await Promise.all([
    pieceStockBySize(tenantId),
    getPrisma().piece.count({ where: { tenantId, status: "vendida" } }),
  ]);
  return { emEstoque: bySize.reduce((s, x) => s + x.count, 0), vendidas, bySize };
}

/** Acha uma peça pelo código (pro scan/baixa). */
export async function findPiece(tenantId: string, code: string) {
  return getPrisma().piece.findFirst({ where: { tenantId, code: code.trim() } });
}

/** Dá baixa numa peça (venda). Idempotente: já vendida → ok sem alterar. */
export async function sellPiece(tenantId: string, code: string) {
  return withTenant(tenantId, async (tx) => {
    const piece = await tx.piece.findFirst({ where: { tenantId, code: code.trim() } });
    if (!piece) throw new Error("peça não encontrada");
    if (piece.status === "vendida") return { ok: true as const, alreadySold: true as const, piece };
    const updated = await tx.piece.update({ where: { id: piece.id }, data: { status: "vendida", soldAt: new Date() } });
    return { ok: true as const, alreadySold: false as const, piece: updated };
  });
}
