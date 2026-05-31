import { test } from "node:test";
import assert from "node:assert/strict";
import { operationalTag, guidanceForTags, isCustomerTag, CUSTOMER_TAG_KEYS, autoTags, effectiveTags } from "./customer-tags.js";

test("autoTags: novo com 0 pedidos; frequente a partir do limite", () => {
  assert.deepEqual(autoTags({ ordersCount: 0 }), ["novo"]);
  assert.deepEqual(autoTags({ ordersCount: 1 }), [], "1-2 pedidos: nenhum");
  assert.deepEqual(autoTags({ ordersCount: 3 }), ["frequente"]);
  assert.deepEqual(autoTags({ ordersCount: 10 }, { frequentMin: 5 }), ["frequente"]);
});

test("effectiveTags: une manuais + automáticas sem duplicar", () => {
  assert.deepEqual(effectiveTags(["pechincheiro"], { ordersCount: 5 }).sort(), ["frequente", "pechincheiro"]);
  assert.deepEqual(effectiveTags(["frequente"], { ordersCount: 5 }), ["frequente"], "sem duplicar");
  assert.deepEqual(effectiveTags(["banido"], { ordersCount: 0 }).sort(), ["banido", "novo"]);
});

test("operationalTag: banido bloqueia; atencao_humana escala; senão null", () => {
  assert.equal(operationalTag(["banido"]), "block");
  assert.equal(operationalTag(["atencao_humana"]), "human");
  assert.equal(operationalTag(["banido", "atencao_humana"]), "block", "banido domina");
  assert.equal(operationalTag(["frequente", "pechincheiro"]), null);
  assert.equal(operationalTag([]), null);
  assert.equal(operationalTag(null), null);
});

test("guidanceForTags: só tags comportamentais geram orientação", () => {
  const g = guidanceForTags(["pechincheiro", "frequente", "banido"]);
  assert.equal(g.length, 2, "banido não tem guidance (é operacional)");
  assert.ok(g.some((x) => /Pechincheiro/.test(x)));
  assert.ok(g.some((x) => /frequente/i.test(x)));
});

test("isCustomerTag / vocabulário", () => {
  assert.ok(isCustomerTag("frequente"));
  assert.ok(!isCustomerTag("inexistente"));
  assert.deepEqual([...CUSTOMER_TAG_KEYS].sort(), ["atencao_humana", "banido", "frequente", "novo", "pechincheiro", "problematico"].sort());
});
