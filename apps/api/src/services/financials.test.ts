import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeFinancials, buildFunnel, DEFAULT_GATEWAY_FEES, type FinancialOrder } from "./financials.js";

const order = (over: Partial<FinancialOrder>): FinancialOrder => ({
  totalBRL: 0, subtotalBRL: 0, shippingBRL: 0, paymentMethod: "pix", items: [], ...over,
});

test("summarizeFinancials: vazio → tudo zero", () => {
  const r = summarizeFinancials([]);
  assert.equal(r.realizedOrders, 0);
  assert.equal(r.netMarginBRL, 0);
  assert.equal(r.netMarginPct, 0);
});

test("summarizeFinancials: 1 pedido PIX (margem = subtotal − COGS − gateway)", () => {
  // Vestido: subtotal 289, frete 19.90, total 308.90, COGS 102, gateway PIX 0.99% de 308.90
  const r = summarizeFinancials([
    order({ totalBRL: 308.9, subtotalBRL: 289, shippingBRL: 19.9, paymentMethod: "pix",
      items: [{ quantity: 1, product: { costBRL: 102 } }] }),
  ]);
  assert.equal(r.realizedOrders, 1);
  assert.equal(r.grossRevenueBRL, 308.9);
  assert.equal(r.cogsBRL, 102);
  assert.equal(r.gatewayFeesBRL, 3.06);          // 308.90 * 0.0099 = 3.058 → 3.06
  assert.equal(r.netMarginBRL, 183.94);          // 289 − 102 − 3.06
  assert.equal(r.netMarginPct, 63.6);            // 183.94 / 289
  assert.equal(r.ordersMissingCost, 0);
});

test("summarizeFinancials: cartão usa taxa maior (3.99%)", () => {
  const r = summarizeFinancials([
    order({ totalBRL: 100, subtotalBRL: 100, shippingBRL: 0, paymentMethod: "card",
      items: [{ quantity: 1, product: { costBRL: 0 } }] }),
  ]);
  assert.equal(r.gatewayFeesBRL, 3.99);
});

test("summarizeFinancials: item sem custo é sinalizado e COGS não soma", () => {
  const r = summarizeFinancials([
    order({ totalBRL: 200, subtotalBRL: 200, paymentMethod: "pix",
      items: [{ quantity: 2, product: { costBRL: null } }] }),
  ]);
  assert.equal(r.cogsBRL, 0);
  assert.equal(r.ordersMissingCost, 1);
});

test("summarizeFinancials: COGS multiplica pela quantidade; método nulo cai pra PIX", () => {
  const r = summarizeFinancials([
    order({ totalBRL: 300, subtotalBRL: 300, paymentMethod: null,
      items: [{ quantity: 3, product: { costBRL: 50 } }] }),
  ]);
  assert.equal(r.cogsBRL, 150);                  // 50 * 3
  assert.equal(r.gatewayFeesBRL, Number((300 * DEFAULT_GATEWAY_FEES.pix!).toFixed(2)));
});

test("summarizeFinancials: aceita Decimal-like (toString) e soma vários pedidos", () => {
  const dec = (v: string) => ({ toString: () => v });
  const r = summarizeFinancials([
    order({ totalBRL: dec("308.90"), subtotalBRL: dec("289"), shippingBRL: dec("19.90"), items: [{ quantity: 1, product: { costBRL: dec("102") } }] }),
    order({ totalBRL: dec("100"), subtotalBRL: dec("100"), items: [{ quantity: 1, product: { costBRL: dec("40") } }] }),
  ]);
  assert.equal(r.realizedOrders, 2);
  assert.equal(r.subtotalBRL, 389);
  assert.equal(r.cogsBRL, 142);
});

test("buildFunnel: contagens viram etapas + % da etapa anterior", () => {
  const f = buildFunnel({ conversations: 5, ordersCreated: 1, ordersPaid: 1, ordersDelivered: 1, ordersCanceled: 0 });
  assert.deepEqual(f.stages.map((s) => s.count), [5, 1, 1, 1]);
  assert.equal(f.stages[1]!.rateFromPrev, 20);   // 1/5
  assert.equal(f.stages[2]!.rateFromPrev, 100);  // 1/1
  assert.equal(f.overallConversionPct, 20);
  assert.equal(f.ordersCanceled, 0);
});

test("buildFunnel: divisão por zero → 0% (sem NaN)", () => {
  const f = buildFunnel({ conversations: 0, ordersCreated: 0, ordersPaid: 0, ordersDelivered: 0, ordersCanceled: 0 });
  assert.equal(f.stages[1]!.rateFromPrev, 0);
  assert.equal(f.overallConversionPct, 0);
});
