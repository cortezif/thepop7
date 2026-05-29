import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";

/**
 * Agendamento dos marcos proativos de pós-venda (Lia) — ADR-010.
 *
 * Quando um pedido chega a `delivered`, enfileiramos 4 jobs *delayed* na fila
 * "post-sale" (a mesma que o worker consome). Cada job acorda no offset certo e
 * chama `POST /post-sale/trigger`, que gera/envia a mensagem da Lia.
 *
 * Degradação graciosa: sem Redis (ex.: dev local sem Docker) o enqueue falha
 * em silêncio e devolve `scheduled: 0` — a entrega NÃO quebra. Nesse caso os
 * marcos ainda podem ser disparados manualmente via `/post-sale/trigger`.
 */

// Offset (em "dias") de cada marco após a entrega.
export const POST_SALE_OFFSETS = { d1: 1, d7: 7, d14: 14, d30: 30 } as const;
export type PostSaleStage = keyof typeof POST_SALE_OFFSETS;

/**
 * Quantos ms vale um "dia" de offset. Padrão = 1 dia real (86.4M ms).
 * Compressível via `POST_SALE_DAY_MS` para verificar o agendamento sem esperar
 * dias (ex.: POST_SALE_DAY_MS=1000 → D+1 em 1s, D+30 em 30s).
 */
export function postSaleDayMs(): number {
  const v = Number(process.env.POST_SALE_DAY_MS);
  return Number.isFinite(v) && v > 0 ? v : 86_400_000;
}

export type ScheduledJob = {
  stage: PostSaleStage;
  delayMs: number;
  /** jobId estável → re-entrega do mesmo pedido não duplica o agendamento. */
  jobId: string;
};

/** Lógica pura de agendamento — testável sem Redis. */
export function computePostSaleSchedule(orderId: string, dayMs = postSaleDayMs()): ScheduledJob[] {
  return (Object.keys(POST_SALE_OFFSETS) as PostSaleStage[]).map((stage) => ({
    stage,
    delayMs: POST_SALE_OFFSETS[stage] * dayMs,
    jobId: `post-sale:${orderId}:${stage}`,
  }));
}

let queue: Queue | null = null;

function getQueue(): Queue {
  if (!queue) {
    const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    // Sem listener de erro, um Redis offline derruba o processo com unhandled error.
    connection.on("error", () => {});
    queue = new Queue("post-sale", { connection });
  }
  return queue;
}

/**
 * Agenda os 4 marcos (D+1/D+7/D+14/D+30) para um pedido entregue.
 * Idempotente por jobId. Nunca lança — devolve quantos jobs foram agendados.
 */
export async function enqueuePostSale(tenantSlug: string, orderId: string): Promise<{ scheduled: number }> {
  const jobs = computePostSaleSchedule(orderId);
  try {
    const q = getQueue();
    await Promise.all(
      jobs.map((j) =>
        q.add(
          "stage",
          { tenantSlug, orderId, stage: j.stage },
          { delay: j.delayMs, jobId: j.jobId, removeOnComplete: 100, removeOnFail: 200 },
        ),
      ),
    );
    return { scheduled: jobs.length };
  } catch {
    // Redis indisponível — entrega segue normal, marcos via /post-sale/trigger.
    return { scheduled: 0 };
  }
}
