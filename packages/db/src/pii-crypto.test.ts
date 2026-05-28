// Chave fixa pro teste ser determinístico (antes de qualquer uso do helper).
process.env.PII_KEY = "1".repeat(64);

import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptPII, decryptPII, hashPII } from "./pii-crypto.js";

test("roundtrip: decrypt(encrypt(x)) === x", () => {
  for (const v of ["+5511999998888", "maria@exemplo.com", "123.456.789-00", "acentuação çãõ"]) {
    assert.equal(decryptPII(encryptPII(v)), v);
  }
});

test("ciphertext tem prefixo enc:v1: e não é o texto puro", () => {
  const enc = encryptPII("+5511999998888")!;
  assert.match(enc, /^enc:v1:/);
  assert.ok(!enc.includes("+5511999998888"));
});

test("IV aleatório: mesmo input → ciphertext diferente, mas decifra igual", () => {
  const a = encryptPII("segredo")!;
  const b = encryptPII("segredo")!;
  assert.notEqual(a, b, "ciphertexts devem diferir (IV aleatório)");
  assert.equal(decryptPII(a), "segredo");
  assert.equal(decryptPII(b), "segredo");
});

test("encrypt é idempotente (não re-cifra valor já cifrado)", () => {
  const once = encryptPII("x")!;
  assert.equal(encryptPII(once), once);
});

test("null/'' passam direto", () => {
  assert.equal(encryptPII(null), null);
  assert.equal(encryptPII(""), null);
  assert.equal(decryptPII(null), null);
  assert.equal(hashPII(null), null);
  assert.equal(hashPII(""), null);
});

test("decrypt de texto puro/legado retorna como está", () => {
  assert.equal(decryptPII("+5511000000000"), "+5511000000000");
});

test("decrypt de ciphertext adulterado não lança (degrada)", () => {
  const enc = encryptPII("importante")!;
  const tampered = enc.slice(0, -4) + "AAAA";
  // Não deve lançar; retorna algo (o valor armazenado) sem quebrar o fluxo.
  assert.doesNotThrow(() => decryptPII(tampered));
});

test("hashPII determinístico e sensível ao valor", () => {
  assert.equal(hashPII("+5511999998888"), hashPII("+5511999998888"));
  assert.notEqual(hashPII("+5511999998888"), hashPII("+5511999990000"));
});

test("hashPII normaliza e-mail (caixa) e espaços", () => {
  assert.equal(hashPII("Maria@Exemplo.com"), hashPII("maria@exemplo.com"));
  assert.equal(hashPII("  +5511999998888  "), hashPII("+5511999998888"));
});

test("hashPII não tenta hashear ciphertext", () => {
  assert.equal(hashPII(encryptPII("+5511999998888")), null);
});
