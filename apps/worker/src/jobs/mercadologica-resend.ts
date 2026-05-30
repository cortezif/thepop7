import type { Job } from "bullmq";

/**
 * Job recorrente (ADR-029): aciona a varredura de reenvio de convites de cotação
 * vencidos via endpoint da API (mesmo padrão desacoplado do post-sale). A API faz
 * a orquestração (db/connectors num lugar só). Roda de hora em hora.
 */
const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3001";

export async function mercadologicaResendProcessor(_job: Job): Promise<void> {
  const res = await fetch(`${API_BASE}/cron/mercadologica-resend`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-key": process.env.CRON_SECRET ?? "" },
  });
  if (!res.ok) throw new Error(`mercadologica-resend ${res.status}: ${await res.text()}`);
  const r = (await res.json()) as { resent?: number; gaveUp?: number };
  if ((r.resent ?? 0) > 0 || (r.gaveUp ?? 0) > 0) {
    console.log(`[mercadologica-resend] reenviados=${r.resent} desistidos=${r.gaveUp}`);
  }
}
