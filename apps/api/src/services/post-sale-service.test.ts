import { test } from "node:test";
import assert from "node:assert/strict";
import { nfeSuffix } from "./post-sale-service.js";

test("nfeSuffix: D+1 com nota + PDF → linha com número e link", () => {
  const s = nfeSuffix("d1", "000134993", "https://cdn/nfe.pdf");
  assert.match(s, /NF-e 000134993/);
  assert.match(s, /https:\/\/cdn\/nfe\.pdf/);
  assert.ok(s.startsWith("\n\n")); // separado da mensagem da Lia
});

test("nfeSuffix: D+1 com nota sem PDF → termina com ponto, sem link", () => {
  const s = nfeSuffix("d1", "000134993", null);
  assert.match(s, /NF-e 000134993\) já está emitida\.$/);
  assert.ok(!s.includes("http"));
});

test("nfeSuffix: só anexa no D+1 (outros estágios → vazio)", () => {
  assert.equal(nfeSuffix("d7", "000134993", "x.pdf"), "");
  assert.equal(nfeSuffix("d14", "000134993", "x.pdf"), "");
  assert.equal(nfeSuffix("d30", "000134993", "x.pdf"), "");
});

test("nfeSuffix: sem nota emitida → vazio (não anexa nada)", () => {
  assert.equal(nfeSuffix("d1", null, null), "");
  assert.equal(nfeSuffix("d1", undefined, "x.pdf"), "");
});
