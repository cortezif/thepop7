import { test } from "node:test";
import assert from "node:assert/strict";
import { netBalance } from "./stock-movement-service.js";

test("netBalance: entradas somam, saídas subtraem", () => {
  const movs = [
    { type: "purchase_in", quantity: 10 },
    { type: "sale_out", quantity: 3 },
    { type: "return_in", quantity: 1 },
    { type: "adjust_out", quantity: 2 },
    { type: "adjust_in", quantity: 5 },
  ];
  // +10 -3 +1 -2 +5 = 11
  assert.equal(netBalance(movs), 11);
});

test("netBalance: vazio → 0; só saídas → negativo", () => {
  assert.equal(netBalance([]), 0);
  assert.equal(netBalance([{ type: "sale_out", quantity: 4 }]), -4);
});
