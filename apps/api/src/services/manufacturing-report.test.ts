import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateConsumption } from "./production-service.js";

test("aggregateConsumption: soma por insumo + custo, ordena por custo desc", () => {
  const r = aggregateConsumption([
    { consumed: [{ name: "Farinha", baseUnit: "g", quantity: 800, costPerBaseUnit: 0.006 }, { name: "Ovo", baseUnit: "un", quantity: 4, costPerBaseUnit: 0.7 }] },
    { consumed: [{ name: "Farinha", baseUnit: "g", quantity: 1600, costPerBaseUnit: 0.006 }] },
  ]);
  const farinha = r.find((x) => x.name === "Farinha")!;
  assert.equal(farinha.quantity, 2400);
  assert.equal(farinha.costBRL, 14.4); // 2400 * 0.006
  const ovo = r.find((x) => x.name === "Ovo")!;
  assert.equal(ovo.costBRL, 2.8);
  assert.equal(r[0]!.name, "Farinha"); // maior custo primeiro
});

test("aggregateConsumption: tolera consumed vazio/ inválido", () => {
  assert.deepEqual(aggregateConsumption([{ consumed: null }, { consumed: [] }]), []);
});
