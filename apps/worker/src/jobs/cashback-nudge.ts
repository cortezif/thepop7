import type { Job } from "bullmq";

/**
 * Job recorrente (ADR-031 fase 2c): aciona o lembrete de cashback a vencer via
 * endpoint da API (mesmo padrão desacoplado da mercadológica). A API orquestra
 * db/connectors num só lugar. Roda 1x/dia.
 */
const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3001";

export async function cashbackNudgeProcessor(_job: Job): Promise<void> {
  const res = await fetch(`${API_BASE}/cron/cashback-nudge`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-key": process.env.CRON_SECRET ?? "" },
    body: JSON.stringify({ withinDays: 5 }),
  });
  if (!res.ok) throw new Error(`cashback-nudge ${res.status}: ${await res.text()}`);
  const r = (await res.json()) as { tenants?: number; contacts?: number };
  if ((r.contacts ?? 0) > 0) {
    console.log(`[cashback-nudge] lojas=${r.tenants} clientes lembrados=${r.contacts}`);
  }
}
