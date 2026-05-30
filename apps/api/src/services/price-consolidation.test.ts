import { test } from "node:test";
import assert from "node:assert/strict";
import { consolidatePrices } from "./price-consolidation.js";

test("mediana de 3 preços homogêneos", () => {
  const r = consolidatePrices([45.99, 46.0, 48.5], { method: "mediana" });
  assert.equal(r.estimate, 46.0);
  assert.equal(r.meetsMinimumThree, true);
  assert.equal(r.dispersionAlert, false);
  assert.equal(r.discarded.length, 0);
});

test("descarta outlier alto e baixo relativos à mediana", () => {
  const r = consolidatePrices([45.99, 46.0, 48.5, 120.0, 12.0]);
  const valores = r.validPrices.sort((a, b) => a - b);
  assert.deepEqual(valores, [45.99, 46.0, 48.5]);
  assert.equal(r.discarded.length, 2);
  assert.ok(r.discarded.some((d) => d.reason === "excessivamente-elevado"));
  assert.ok(r.discarded.some((d) => d.reason === "inexequivel"));
});

test("método média", () => {
  const r = consolidatePrices([10, 20, 30], { method: "media" });
  assert.equal(r.estimate, 20);
});

test("método menor-preço", () => {
  const r = consolidatePrices([10, 20, 30], { method: "menor-preco" });
  assert.equal(r.estimate, 10);
});

test("menos de 3 preços não atende mínimo e não descarta", () => {
  const r = consolidatePrices([10, 50]);
  assert.equal(r.meetsMinimumThree, false);
  assert.equal(r.discarded.length, 0);
  assert.equal(r.count, 2);
});

test("alerta de dispersão quando CV alto", () => {
  const r = consolidatePrices([10, 11, 90], { upperFactor: 100, lowerFactor: 1 });
  assert.equal(r.dispersionAlert, true);
});

test("ignora valores não positivos/inválidos", () => {
  const r = consolidatePrices([0, -5, 30, 32, 31, NaN]);
  assert.equal(r.count, 3);
  assert.equal(r.meetsMinimumThree, true);
});
