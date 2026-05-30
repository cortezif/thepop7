import { getPrisma, withTenant } from "@hubadvisor/db";

/**
 * NPS (ADR-017). Cálculo puro do score (% promotores − % detratores) e
 * agregação por tipo (produto/atendimento). Promotor 9-10, neutro 7-8, detrator 0-6.
 */
export type NpsSummary = { score: number; responses: number; promotores: number; neutros: number; detratores: number };

export function computeNps(scores: number[]): NpsSummary {
  const responses = scores.length;
  if (responses === 0) return { score: 0, responses: 0, promotores: 0, neutros: 0, detratores: 0 };
  const promotores = scores.filter((s) => s >= 9).length;
  const detratores = scores.filter((s) => s <= 6).length;
  const neutros = responses - promotores - detratores;
  const score = Math.round(((promotores - detratores) / responses) * 100);
  return { score, responses, promotores, neutros, detratores };
}

/** Parse de uma nota NPS solta (0-10) numa mensagem curta. null se não for nota. */
export function parseNpsScore(text: string): number | null {
  const m = text.trim().match(/^(10|[0-9])(?:\s|$|\/|de)/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 10 ? n : null;
}

export async function recordNps(tenantId: string, input: { contactId?: string; orderId?: string; kind?: string; score: number; comment?: string }) {
  return withTenant(tenantId, async (tx) => {
    const r = await tx.npsResponse.create({
      data: {
        tenantId, contactId: input.contactId, orderId: input.orderId,
        kind: input.kind === "atendimento" ? "atendimento" : "produto",
        score: Math.max(0, Math.min(10, Math.round(input.score))),
        comment: input.comment,
      },
    });
    return { ok: true as const, id: r.id };
  });
}

/** Resumo NPS por tipo + geral, pro painel. */
export async function npsSummary(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.npsResponse.findMany({ select: { kind: true, score: true } });
    const all = rows.map((r) => r.score);
    const byKind = (k: string) => computeNps(rows.filter((r) => r.kind === k).map((r) => r.score));
    return { geral: computeNps(all), produto: byKind("produto"), atendimento: byKind("atendimento") };
  });
}
