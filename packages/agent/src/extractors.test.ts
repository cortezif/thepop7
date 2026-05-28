import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeAttributes,
  type ExtractedProductAttributes,
} from "./extractors.js";

// Base válida — todos os campos dentro do vocabulário.
function base(): ExtractedProductAttributes {
  return {
    styles: ["casual"],
    occasions: ["dia-a-dia"],
    neckline: "medio",
    sheer: false,
    length: "medio",
    sleeveType: "curta",
    confidence: 0.8,
    reasoning: "ok",
  };
}

test("mantém atributos já válidos inalterados", () => {
  const input = base();
  const out = sanitizeAttributes(input, "Vestido X");
  assert.deepEqual(out, input);
});

test("remove valores fora do vocabulário em styles/occasions", () => {
  const out = sanitizeAttributes(
    { ...base(), styles: ["casual", "passeio"], occasions: ["eventos-informais", "igreja"] },
    "Vestido X"
  );
  assert.deepEqual(out.styles, ["casual"]);
  assert.deepEqual(out.occasions, ["igreja"]);
});

test("usa fallback quando styles fica vazio após filtrar", () => {
  const out = sanitizeAttributes({ ...base(), styles: ["passeio", "xpto"] }, "Vestido X");
  assert.deepEqual(out.styles, ["casual"]);
});

test("usa fallback quando occasions fica vazio após filtrar", () => {
  const out = sanitizeAttributes({ ...base(), occasions: ["eventos-informais"] }, "Vestido X");
  assert.deepEqual(out.occasions, ["dia-a-dia"]);
});

test("trata styles/occasions ausentes (não-array) com fallback", () => {
  const out = sanitizeAttributes(
    { ...base(), styles: undefined as any, occasions: null as any },
    "Vestido X"
  );
  assert.deepEqual(out.styles, ["casual"]);
  assert.deepEqual(out.occasions, ["dia-a-dia"]);
});

test("limita a 3 itens", () => {
  const out = sanitizeAttributes(
    { ...base(), styles: ["casual", "festa", "vintage", "boho", "moderno"] },
    "Vestido X"
  );
  assert.equal(out.styles.length, 3);
  assert.deepEqual(out.styles, ["casual", "festa", "vintage"]);
});

test("aplica fallback conservador em neckline/length/sleeveType inválidos", () => {
  const out = sanitizeAttributes(
    { ...base(), neckline: "altíssimo", length: "midi", sleeveType: "tomara-que-caia" },
    "Vestido X"
  );
  assert.equal(out.neckline, "medio");
  assert.equal(out.length, "medio");
  assert.equal(out.sleeveType, "curta");
});

test("preserva sheer/confidence/reasoning intactos", () => {
  const out = sanitizeAttributes(
    { ...base(), sheer: true, confidence: 0.42, reasoning: "tule visível", styles: ["passeio"] },
    "Vestido X"
  );
  assert.equal(out.sheer, true);
  assert.equal(out.confidence, 0.42);
  assert.equal(out.reasoning, "tule visível");
});
