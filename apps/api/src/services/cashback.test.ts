import { test } from "node:test";
import assert from "node:assert/strict";
import { availableBalance, planRedemption, redeemableFor } from "./cashback-service.js";

const now = new Date("2026-06-01T00:00:00Z");
const future = "2026-07-01T00:00:00Z";
const past = "2026-05-01T00:00:00Z";

test("availableBalance: soma só accruals não-expirados com remaining>0", () => {
  assert.equal(availableBalance([
    { id: "a", remainingBRL: 10, expiresAt: future },
    { id: "b", remainingBRL: 5, expiresAt: past },     // expirado → fora
    { id: "c", remainingBRL: 0, expiresAt: future },   // zerado → fora
    { id: "d", remainingBRL: 3.5, expiresAt: future },
  ], now), 13.5);
});

test("planRedemption: FIFO pelos que vencem primeiro", () => {
  const accruals = [
    { id: "novo", remainingBRL: 20, expiresAt: "2026-08-01T00:00:00Z" },
    { id: "velho", remainingBRL: 8, expiresAt: "2026-06-15T00:00:00Z" }, // vence antes
  ];
  const plan = planRedemption(accruals, 12, now);
  assert.equal(plan.total, 12);
  // consome primeiro o "velho" (8), depois 4 do "novo"
  assert.deepEqual(plan.consume, [{ id: "velho", take: 8 }, { id: "novo", take: 4 }]);
});

test("planRedemption: não consome além do disponível", () => {
  const plan = planRedemption([{ id: "a", remainingBRL: 5, expiresAt: future }], 100, now);
  assert.equal(plan.total, 5);
});

test("redeemableFor: min(saldo, teto% do pedido)", () => {
  assert.equal(redeemableFor(50, 100, 50), 50);  // saldo 50, teto 50 → 50
  assert.equal(redeemableFor(50, 60, 50), 30);   // teto 30 < saldo → 30
  assert.equal(redeemableFor(0, 100, 50), 0);
});
