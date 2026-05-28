import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env"), override: true });

import { Worker, Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";
import pino from "pino";
import { reservationExpiryProcessor } from "./jobs/reservation-expiry.js";
import { postSaleProcessor } from "./jobs/post-sale.js";
import { catalogSyncProcessor } from "./jobs/catalog-sync.js";
import { productEmbeddingProcessor } from "./jobs/product-embedding.js";
import { catalogEnrichmentProcessor } from "./jobs/catalog-enrichment.js";

const log = pino({ name: "worker", transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } } });

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

// Queues e Workers
const queues = {
  "reservation-expiry": new Queue("reservation-expiry", { connection }),
  "post-sale":          new Queue("post-sale", { connection }),
  "catalog-sync":       new Queue("catalog-sync", { connection }),
  "product-embedding":  new Queue("product-embedding", { connection }),
  "catalog-enrichment": new Queue("catalog-enrichment", { connection }),
};

new Worker("reservation-expiry", reservationExpiryProcessor, { connection })
  .on("completed", (job) => log.info({ id: job.id }, "reservation-expiry done"))
  .on("failed", (job, err) => log.error({ id: job?.id, err }, "reservation-expiry failed"));

new Worker("post-sale", postSaleProcessor, { connection })
  .on("completed", (job) => log.info({ id: job.id }, "post-sale done"))
  .on("failed", (job, err) => log.error({ id: job?.id, err }, "post-sale failed"));

new Worker("catalog-sync", catalogSyncProcessor, { connection })
  .on("completed", (job) => log.info({ id: job.id }, "catalog-sync done"))
  .on("failed", (job, err) => log.error({ id: job?.id, err }, "catalog-sync failed"));

new Worker("product-embedding", productEmbeddingProcessor, { connection })
  .on("completed", (job) => log.info({ id: job.id }, "product-embedding done"))
  .on("failed", (job, err) => log.error({ id: job?.id, err }, "product-embedding failed"));

new Worker("catalog-enrichment", catalogEnrichmentProcessor, { connection })
  .on("completed", (job) => log.info({ id: job.id }, "catalog-enrichment done"))
  .on("failed", (job, err) => log.error({ id: job?.id, err }, "catalog-enrichment failed"));

// Recorrência: limpa reservas expiradas a cada minuto
queues["reservation-expiry"].add(
  "sweep",
  {},
  { repeat: { every: 60_000 }, removeOnComplete: 50, removeOnFail: 100 }
);

log.info("Worker iniciado, queues registradas");

process.on("SIGTERM", async () => {
  log.info("Encerrando worker...");
  for (const q of Object.values(queues)) await q.close();
  await connection.quit();
  process.exit(0);
});
