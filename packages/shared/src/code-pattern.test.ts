import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CLOTHING_PATTERN, buildCode, decodeCode, describePattern, validatePattern, formatSegment, sampleValues,
} from "./code-pattern.js";

test("buildCode: padrão de roupas reproduz o exemplo", () => {
  const code = buildCode(DEFAULT_CLOTHING_PATTERN, {
    anoMes: "2603", fornecedor: "01", tipo: "04", custo: "159", margem: "030", numero: "0001", tamanho: "PP",
  });
  assert.equal(code, "26030104159030-0001-PP");
});

test("buildCode: numéricos preenchem com zeros à esquerda; tamanho variável fica como veio", () => {
  const code = buildCode(DEFAULT_CLOTHING_PATTERN, {
    anoMes: "2603", fornecedor: "1", tipo: "4", custo: "9", margem: "5", numero: "7", tamanho: "G",
  });
  // fornecedor 1→01, tipo 4→04, custo 9→009, margem 5→005, numero 7→0007
  assert.equal(code, "26030104009005-0007-G");
});

test("decodeCode: lê de volta os segmentos com rótulos", () => {
  const seg = decodeCode(DEFAULT_CLOTHING_PATTERN, "26030104159030-0001-PP");
  const by = Object.fromEntries(seg.map((s) => [s.key, s.value]));
  assert.equal(by.anoMes, "2603");
  assert.equal(by.fornecedor, "01");
  assert.equal(by.tipo, "04");
  assert.equal(by.custo, "159");
  assert.equal(by.margem, "030");
  assert.equal(by.numero, "0001");
  assert.equal(by.tamanho, "PP");
  assert.equal(seg.find((s) => s.key === "tamanho")!.label, "Tamanho");
});

test("decodeCode: tamanho variável (G, GG) volta certo", () => {
  assert.equal(decodeCode(DEFAULT_CLOTHING_PATTERN, "26030104009005-0007-G").at(-1)!.value, "G");
  assert.equal(decodeCode(DEFAULT_CLOTHING_PATTERN, "26030104009005-0007-GG").at(-1)!.value, "GG");
});

test("build→decode é round-trip", () => {
  const vals = { anoMes: "2512", fornecedor: "07", tipo: "11", custo: "088", margem: "120", numero: "0345", tamanho: "M" };
  const code = buildCode(DEFAULT_CLOTHING_PATTERN, vals);
  const back = Object.fromEntries(decodeCode(DEFAULT_CLOTHING_PATTERN, code).map((s) => [s.key, s.value]));
  assert.deepEqual(back, vals);
});

test("describePattern + sampleValues", () => {
  assert.equal(describePattern(DEFAULT_CLOTHING_PATTERN), "AAAAFFTTCCCMMM-NNNN-ZZ");
  const sample = buildCode(DEFAULT_CLOTHING_PATTERN, sampleValues(DEFAULT_CLOTHING_PATTERN));
  assert.equal(sample, "26030104159030-0001-PP");
});

test("formatSegment: literal vira maiúsculo; numérico só dígitos", () => {
  assert.equal(formatSegment({ key: "x", label: "x", length: 0, kind: "literal", value: "lj" }, undefined), "LJ");
  assert.equal(formatSegment({ key: "c", label: "c", length: 3, kind: "cost" }, "159"), "159");
  assert.equal(formatSegment({ key: "c", label: "c", length: 3, kind: "cost" }, "9"), "009");
});

test("validatePattern: ok no padrão; pega duplicados e variável no meio", () => {
  assert.deepEqual(validatePattern(DEFAULT_CLOTHING_PATTERN), []);
  assert.ok(validatePattern({ segments: [] }).length > 0);
  const dup = validatePattern({ segments: [
    { key: "a", label: "A", length: 2, kind: "supplier" },
    { key: "a", label: "B", length: 2, kind: "productType" },
  ] });
  assert.ok(dup.some((e) => /duplicado/.test(e)));
  const midVar = validatePattern({ segments: [
    { key: "a", label: "A", length: 0, kind: "size" },
    { key: "b", label: "B", length: 2, kind: "supplier" },
  ] });
  assert.ok(midVar.some((e) => /variável/.test(e)));
});
