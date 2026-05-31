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

/** Promotor 9-10, neutro 7-8, detrator 0-6. */
export function npsBand(score: number): "promotor" | "neutro" | "detrator" {
  if (score >= 9) return "promotor";
  if (score >= 7) return "neutro";
  return "detrator";
}

/** Resposta da Lia à nota recebida (varia por faixa). Pura. */
export function npsReply(score: number): string {
  const band = npsBand(score);
  if (band === "promotor") return `Que alegria receber sua nota ${score}! 💛 Muito obrigada — significa muito pra gente.`;
  if (band === "neutro") return `Obrigada pela nota ${score}! 💛 Tem algo que a gente poderia melhorar pra você? Sua opinião ajuda demais.`;
  return `Poxa, sinto muito que a experiência não tenha sido como você esperava 😔 Me conta rapidinho o que poderia ter sido melhor? Vou levar pessoalmente pra nossa equipe cuidar disso.`;
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
    const rows = await tx.npsResponse.findMany({ where: { tenantId }, select: { kind: true, score: true } });
    const all = rows.map((r) => r.score);
    const byKind = (k: string) => computeNps(rows.filter((r) => r.kind === k).map((r) => r.score));
    return { geral: computeNps(all), produto: byKind("produto"), atendimento: byKind("atendimento") };
  });
}

/**
 * NPS de detrator recente AINDA sem comentário (p/ capturar a justificativa na
 * próxima mensagem do cliente). `withinMin` default 60.
 */
export async function pendingDetractorComment(tenantId: string, contactId: string, withinMin = 60) {
  return withTenant(tenantId, async (tx) =>
    tx.npsResponse.findFirst({
      where: { tenantId, contactId, score: { lte: 6 }, comment: null, createdAt: { gte: new Date(Date.now() - withinMin * 60_000) } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
  );
}

export async function attachNpsComment(tenantId: string, id: string, comment: string) {
  return withTenant(tenantId, (tx) => tx.npsResponse.update({ where: { id }, data: { comment: comment.slice(0, 2000) } }));
}

/** Comentários recentes (com nota e faixa) pro painel de NPS. */
export async function npsComments(tenantId: string, limit = 30) {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.npsResponse.findMany({
      where: { tenantId, comment: { not: null } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, score: true, comment: true, kind: true, createdAt: true },
    });
    return rows.map((r) => ({ ...r, band: npsBand(r.score) }));
  });
}
