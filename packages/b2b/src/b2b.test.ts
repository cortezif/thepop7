import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWholesaleQuote, wholesaleUnitPrice, availableStock, hashApiKey, computeCommission, commissionRate, type RawWholesaleProduct } from "./index.js";

const prod = (over: Partial<RawWholesaleProduct>): RawWholesaleProduct => ({
  id: "p1", tenantId: "t1", name: "Vestido", priceBRL: 200, wholesalePriceBRL: 120,
  wholesaleMinQty: 5, wholesaleEnabled: true, active: true,
  variants: [{ sku: "V-M", stock: 10 }, { sku: "V-G", stock: 4 }], ...over,
});

test("wholesaleUnitPrice: usa atacado; cai pro preço normal se ausente", () => {
  assert.equal(wholesaleUnitPrice(prod({})), 120);
  assert.equal(wholesaleUnitPrice(prod({ wholesalePriceBRL: null })), 200);
});

test("availableStock: soma variantes ou SKU específico", () => {
  assert.equal(availableStock(prod({})), 14);
  assert.equal(availableStock(prod({}), "V-G"), 4);
});

test("buildWholesaleQuote: cotação válida → total e linhas", () => {
  const r = buildWholesaleQuote([prod({})], [{ productId: "p1", qty: 5 }]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.sellerTenantId, "t1");
    assert.equal(r.totalBRL, 600);            // 120 * 5
    assert.equal(r.lines[0]!.unitWholesaleBRL, 120);
  }
});

test("buildWholesaleQuote: abaixo da quantidade mínima → erro", () => {
  const r = buildWholesaleQuote([prod({})], [{ productId: "p1", qty: 3 }]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.errors[0]!, /mínima de atacado é 5/);
});

test("buildWholesaleQuote: estoque insuficiente → erro", () => {
  const r = buildWholesaleQuote([prod({})], [{ productId: "p1", qty: 20 }]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.errors[0]!, /estoque insuficiente/);
});

test("buildWholesaleQuote: produto não exposto → erro", () => {
  const r = buildWholesaleQuote([prod({ wholesaleEnabled: false })], [{ productId: "p1", qty: 5 }]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.errors[0]!, /não está disponível no atacado/);
});

test("buildWholesaleQuote: itens de vendedores diferentes → erro (pedido é por loja)", () => {
  const r = buildWholesaleQuote(
    [prod({ id: "p1", tenantId: "t1" }), prod({ id: "p2", tenantId: "t2" })],
    [{ productId: "p1", qty: 5 }, { productId: "p2", qty: 5 }],
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.errors.join(" "), /um único vendedor/);
});

test("buildWholesaleQuote: sem itens → erro", () => {
  const r = buildWholesaleQuote([], []);
  assert.equal(r.ok, false);
});

test("computeCommission: comissão + líquido do vendedor (5% default)", () => {
  const r = computeCommission(600, 0.05);
  assert.deepEqual(r, { commissionPct: 0.05, commissionBRL: 30, sellerNetBRL: 570 });
});

test("commissionRate: default 5%; env override; negativo cai no default; cap 100%", () => {
  delete process.env.B2B_COMMISSION_PCT;
  assert.equal(commissionRate(), 0.05);
  process.env.B2B_COMMISSION_PCT = "0.08";
  assert.equal(commissionRate(), 0.08);
  process.env.B2B_COMMISSION_PCT = "-1";
  assert.equal(commissionRate(), 0.05);
  process.env.B2B_COMMISSION_PCT = "2";
  assert.equal(commissionRate(), 1);
  delete process.env.B2B_COMMISSION_PCT;
});

test("hashApiKey: determinístico, hex de 64 chars, sensível à key", () => {
  const h = hashApiKey("b2b_abc");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(hashApiKey("b2b_abc"), h);            // determinístico
  assert.notEqual(hashApiKey("b2b_abc"), hashApiKey("b2b_xyz"));
  assert.equal(hashApiKey(" b2b_abc "), h);          // trim
});
