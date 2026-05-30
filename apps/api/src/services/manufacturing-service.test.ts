import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBomCost } from "./manufacturing-service.js";

// Bolo: 800g farinha @0,005/g + 600g açúcar @0,004/g + 4 ovos @0,50/un
// = 4,00 + 2,40 + 2,00 = 8,40
const BOLO = [
  { quantity: 800, costPerBaseUnit: 0.005 },
  { quantity: 600, costPerBaseUnit: 0.004 },
  { quantity: 4, costPerBaseUnit: 0.5 },
];

test("custo total e unitário sem perda, rende 1", () => {
  const r = computeBomCost(BOLO, 1, 0);
  assert.equal(r.totalCost, 8.4);
  assert.equal(r.unitCost, 8.4);
});

test("rendimento divide o custo unitário", () => {
  const r = computeBomCost(BOLO, 2, 0);
  assert.equal(r.totalCost, 8.4);
  assert.equal(r.unitCost, 4.2);
});

test("perda esperada aumenta o custo proporcionalmente", () => {
  const r = computeBomCost(BOLO, 1, 10); // +10%
  assert.equal(r.totalCost, 9.24);
  assert.equal(r.unitCost, 9.24);
});

test("receita vazia custa zero", () => {
  const r = computeBomCost([], 1, 0);
  assert.equal(r.totalCost, 0);
  assert.equal(r.unitCost, 0);
});

test("rendimento <= 0 não divide por zero (trata como 1)", () => {
  const r = computeBomCost(BOLO, 0, 0);
  assert.equal(r.unitCost, 8.4);
});

test("perda e rendimento combinados", () => {
  // (8,40 × 1,05) ÷ 3 = 8,82 ÷ 3 = 2,94
  const r = computeBomCost(BOLO, 3, 5);
  assert.equal(r.totalCost, 8.82);
  assert.equal(r.unitCost, 2.94);
});
