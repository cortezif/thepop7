import { test } from "node:test";
import assert from "node:assert/strict";
import { storeMapsUrl, enrichPoliciesWithMaps } from "./store-pickup.js";

test("storeMapsUrl: link explícito tem prioridade", () => {
  const url = storeMapsUrl({ storeAddress: "Rua X, 1", storeMapsUrl: "https://maps.app.goo.gl/abc" });
  assert.equal(url, "https://maps.app.goo.gl/abc");
});

test("storeMapsUrl: gera link de busca a partir do endereço", () => {
  const url = storeMapsUrl({ storeAddress: "Rua das Flores, 123 — Centro" });
  assert.match(url ?? "", /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.match(url ?? "", /Rua%20das%20Flores/);
});

test("storeMapsUrl: sem endereço nem link → null", () => {
  assert.equal(storeMapsUrl({}), null);
  assert.equal(storeMapsUrl(null), null);
});

test("enrichPoliciesWithMaps: injeta storeMapsUrl resolvido", () => {
  const p = enrichPoliciesWithMaps({ storeAddress: "Av. Brasil, 500", faq: "..." });
  assert.ok(typeof p.storeMapsUrl === "string");
  assert.equal(p.faq, "...");
  // sem endereço → não inventa o campo
  assert.equal(enrichPoliciesWithMaps({ faq: "x" }).storeMapsUrl, undefined);
});
