import { test } from "node:test";
import assert from "node:assert/strict";
import { operationalTag, guidanceForTags, isCustomerTag, CUSTOMER_TAG_KEYS } from "./customer-tags.js";

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
