import { test } from "node:test";
import assert from "node:assert/strict";
import { ean13CheckDigit, isValidEan13, generateInternalEan13, normalizeBarcode, resolveBarcode } from "./barcode.js";

test("ean13CheckDigit: EAN-13 de referência (Faber-Castell 4006381333931)", () => {
  assert.equal(ean13CheckDigit("400638133393"), 1);
  assert.equal(ean13CheckDigit("789835741001"), 5);
});

test("isValidEan13: aceita válido, rejeita verificador errado/tamanho/letra", () => {
  assert.equal(isValidEan13("4006381333931"), true);
  assert.equal(isValidEan13("4006381333932"), false); // verificador errado
  assert.equal(isValidEan13("400638133393"), false);  // 12 dígitos
  assert.equal(isValidEan13("400638133393A"), false);  // não numérico
});

test("generateInternalEan13: prefixo 2, 13 dígitos, verificador correto", () => {
  const code = generateInternalEan13(42);
  assert.equal(code.length, 13);
  assert.equal(code[0], "2");
  assert.ok(isValidEan13(code));
  assert.equal(generateInternalEan13(42), code); // determinístico
  assert.notEqual(generateInternalEan13(1), generateInternalEan13(2));
});

test("generateInternalEan13: rejeita fora do intervalo", () => {
  assert.throws(() => generateInternalEan13(0));
  assert.throws(() => generateInternalEan13(1.5));
});

test("normalizeBarcode: tira espaços/traços e trata vazio", () => {
  assert.equal(normalizeBarcode(" 400-6381 333931 "), "4006381333931");
  assert.equal(normalizeBarcode(null), "");
  assert.equal(normalizeBarcode(undefined), "");
});

test("resolveBarcode: usa EAN do ERP se válido; gera interno se faltar/inválido", () => {
  assert.deepEqual(resolveBarcode("4006381333931", 99), { barcode: "4006381333931", generated: false });

  const gen = resolveBarcode("", 99);
  assert.equal(gen.generated, true);
  assert.ok(isValidEan13(gen.barcode));

  const genInvalid = resolveBarcode("123", 7);
  assert.equal(genInvalid.generated, true);
  assert.ok(isValidEan13(genInvalid.barcode));
});
