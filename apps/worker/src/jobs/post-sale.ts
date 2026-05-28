import type { Job } from "bullmq";

/**
 * Job: dispara mensagem proativa pós-venda (Lia) via endpoint da API.
 * Desacoplado: o worker enfileira/agenda, a API faz a orquestração
 * (acesso a db/connectors/agent fica num lugar só).
 *
 * Acionado por jobs agendados (delayed) a partir do evento order.delivered.
 *   d1  → "Como caiu? Curtiu a peça?"
 *   d7  → lembrete do prazo de devolução
 *   d14 → NPS de produto + atendimento
 *   d30 → sugestão de recompra personalizada
 */
type PostSaleJobData = {
  tenantSlug: string;
  orderId: string;
  stage: "d1" | "d7" | "d14" | "d30";
};

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3001";

export async function postSaleProcessor(job: Job<PostSaleJobData>): Promise<void> {
  const { tenantSlug, orderId, stage } = job.data;
  console.log(`[post-sale] tenant=${tenantSlug} order=${orderId} stage=${stage}`);
  const res = await fetch(`${API_BASE}/post-sale/trigger`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantSlug, orderId, stage }),
  });
  if (!res.ok) throw new Error(`post-sale trigger ${res.status}: ${await res.text()}`);
  const r = (await res.json()) as { message?: string };
  console.log(`[post-sale] enviado: "${(r.message ?? "").slice(0, 60)}…"`);
}

// Offsets de agendamento (dias após a entrega) — usados ao enfileirar
// os jobs delayed quando order.delivered dispara.
export const POST_SALE_OFFSETS = { d1: 1, d7: 7, d14: 14, d30: 30 } as const;
