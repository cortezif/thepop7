import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveVocab, sanitizeAttributes, STYLES, OCCASIONS } from "./extractors.js";

test("resolveVocab: sem config → defaults de moda + fashion=true", () => {
  const v = resolveVocab(undefined);
  assert.equal(v.fashion, true);
  assert.deepEqual(v.styles, [...STYLES]);
  assert.deepEqual(v.occasions, [...OCCASIONS]);
});

test("resolveVocab: segmento não-moda → fashion=false", () => {
  const v = resolveVocab({ segment: "farmacia" });
  assert.equal(v.fashion, false);
  // sem vocab custom cai nos defaults (mas o tool não exige atributos de moda)
  assert.ok(v.styles.length > 0);
});

test("resolveVocab: vocabulário custom sobrescreve", () => {
  const v = resolveVocab({ segment: "pet", vocab: { styles: ["racao", "higiene"], occasions: ["filhote", "adulto"] } });
  assert.equal(v.fashion, false);
  assert.deepEqual(v.styles, ["racao", "higiene"]);
  assert.deepEqual(v.occasions, ["filhote", "adulto"]);
});

test("sanitizeAttributes respeita o vocabulário custom (descarta fora dele)", () => {
  const vocab = { styles: ["racao", "higiene"], occasions: ["filhote", "adulto"] };
  const raw: any = {
    styles: ["racao", "festa"],       // "festa" é de moda → deve cair
    occasions: ["filhote", "balada"], // "balada" → deve cair
    neckline: "medio", sheer: false, length: "medio", sleeveType: "curta",
    confidence: 0.8, reasoning: "x",
  };
  const out = sanitizeAttributes(raw, "Ração Premium", vocab);
  assert.deepEqual(out.styles, ["racao"]);
  assert.deepEqual(out.occasions, ["filhote"]);
});

test("sanitizeAttributes sem vocab usa fallback de moda", () => {
  const raw: any = {
    styles: ["inexistente"], occasions: ["inexistente"],
    neckline: "medio", sheer: false, length: "medio", sleeveType: "curta",
    confidence: 0.5, reasoning: "x",
  };
  const out = sanitizeAttributes(raw, "Vestido");
  // tudo fora do vocab → cai no primeiro item do vocab de moda
  assert.equal(out.styles.length, 1);
  assert.ok((STYLES as readonly string[]).includes(out.styles[0]!));
});
