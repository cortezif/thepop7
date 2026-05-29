import { test } from "node:test";
import assert from "node:assert/strict";
import { computePostSaleSchedule, postSaleDayMs, POST_SALE_OFFSETS } from "./post-sale-queue.js";

test("computePostSaleSchedule: 4 marcos com offsets de 1/7/14/30 dias", () => {
  const day = 86_400_000;
  const jobs = computePostSaleSchedule("ord_123", day);
  assert.equal(jobs.length, 4);
  assert.deepEqual(jobs.map((j) => j.stage), ["d1", "d7", "d14", "d30"]);
  assert.deepEqual(jobs.map((j) => j.delayMs), [1 * day, 7 * day, 14 * day, 30 * day]);
});

test("computePostSaleSchedule: jobId estável por pedido+estágio (idempotência)", () => {
  const a = computePostSaleSchedule("ord_abc");
  const b = computePostSaleSchedule("ord_abc");
  assert.deepEqual(a.map((j) => j.jobId), b.map((j) => j.jobId));
  assert.deepEqual(a.map((j) => j.jobId), [
    "post-sale:ord_abc:d1",
    "post-sale:ord_abc:d7",
    "post-sale:ord_abc:d14",
    "post-sale:ord_abc:d30",
  ]);
  // pedidos distintos → jobIds distintos
  const c = computePostSaleSchedule("ord_xyz");
  assert.notDeepEqual(a.map((j) => j.jobId), c.map((j) => j.jobId));
});

test("computePostSaleSchedule: dia compressível para teste (POST_SALE_DAY_MS)", () => {
  const jobs = computePostSaleSchedule("ord_1", 1000);
  assert.deepEqual(jobs.map((j) => j.delayMs), [1000, 7000, 14000, 30000]);
});

test("postSaleDayMs: padrão 1 dia; override válido por env", () => {
  delete process.env.POST_SALE_DAY_MS;
  assert.equal(postSaleDayMs(), 86_400_000);
  process.env.POST_SALE_DAY_MS = "2000";
  assert.equal(postSaleDayMs(), 2000);
  process.env.POST_SALE_DAY_MS = "0"; // inválido → cai no padrão
  assert.equal(postSaleDayMs(), 86_400_000);
  delete process.env.POST_SALE_DAY_MS;
});

test("offsets batem com o contrato do worker (d1/d7/d14/d30)", () => {
  assert.deepEqual(POST_SALE_OFFSETS, { d1: 1, d7: 7, d14: 14, d30: 30 });
});
