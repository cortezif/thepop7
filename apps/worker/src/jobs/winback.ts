import type { Job } from "bullmq";

/**
 * Job recorrente (ADR-031): recompra automática — mensagem de volta p/ clientes
 * inativos. Aciona o endpoint da API (mesmo padrão desacoplado dos demais crons).
 * Roda 1x por semana.
 */
const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3001";

export async function winbackProcessor(_job: Job): Promise<void> {
  const res = await fetch(`${API_BASE}/cron/winback`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-key": process.env.CRON_SECRET ?? "" },
  });
  if (!res.ok) throw new Error(`winback ${res.status}: ${await res.text()}`);
  const r = (await res.json()) as { tenants?: number; contacts?: number };
  if ((r.contacts ?? 0) > 0) {
    console.log(`[winback] lojas=${r.tenants} clientes reativados=${r.contacts}`);
  }
}
