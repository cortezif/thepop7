import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNps, parseNpsScore, npsBand, npsReply } from "./nps.js";

test("computeNps: vazio → 0", () => {
  assert.deepEqual(computeNps([]), { score: 0, responses: 0, promotores: 0, neutros: 0, detratores: 0 });
});

test("computeNps: promotores − detratores", () => {
  // 3 promotores (9,10,10), 1 neutro (7), 1 detrator (3) → (3-1)/5 = 40
  const r = computeNps([9, 10, 10, 7, 3]);
  assert.equal(r.promotores, 3);
  assert.equal(r.neutros, 1);
  assert.equal(r.detratores, 1);
  assert.equal(r.score, 40);
});

test("computeNps: todos promotores → 100; todos detratores → -100", () => {
  assert.equal(computeNps([9, 10, 9]).score, 100);
  assert.equal(computeNps([0, 5, 6]).score, -100);
});

test("npsBand: faixas promotor/neutro/detrator", () => {
  assert.equal(npsBand(10), "promotor");
  assert.equal(npsBand(9), "promotor");
  assert.equal(npsBand(8), "neutro");
  assert.equal(npsBand(7), "neutro");
  assert.equal(npsBand(6), "detrator");
  assert.equal(npsBand(0), "detrator");
});

test("npsReply: detrator pede motivo; promotor agradece", () => {
  assert.match(npsReply(3), /o que poderia ter sido melhor/i);
  assert.match(npsReply(10), /obrigada/i);
  assert.doesNotMatch(npsReply(10), /sinto muito/i);
});

test("parseNpsScore: notas válidas e inválidas", () => {
  assert.equal(parseNpsScore("10"), 10);
  assert.equal(parseNpsScore("9"), 9);
  assert.equal(parseNpsScore("0"), 0);
  assert.equal(parseNpsScore("nota 8"), null);   // não começa com número
  assert.equal(parseNpsScore("quero 3 peças"), null); // "3 peças" não é nota pura
  assert.equal(parseNpsScore("11"), null);        // fora de 0-10
  assert.equal(parseNpsScore("8/10"), 8);
});
