import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchInstagramProfile } from "./instagram.js";

// Guards da busca de perfil IG (ADR-034). O caminho de rede é coberto em produção;
// aqui garantimos que sem igsid/token degrada pra null (não-fatal).

test("fetchInstagramProfile: sem igsid ou token → null (sem chamar rede)", async () => {
  assert.equal(await fetchInstagramProfile("", "tok"), null);
  assert.equal(await fetchInstagramProfile("igsid", ""), null);
  assert.equal(await fetchInstagramProfile("", ""), null);
});

test("fetchInstagramProfile: erro de rede → null", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("boom"); }) as typeof fetch;
  try {
    assert.equal(await fetchInstagramProfile("igsid", "tok"), null);
  } finally {
    globalThis.fetch = orig;
  }
});

test("fetchInstagramProfile: resposta ok devolve nome/username", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ name: "Maria Silva", username: "maria.sil" }) })) as unknown as typeof fetch;
  try {
    const p = await fetchInstagramProfile("igsid", "tok");
    assert.deepEqual(p, { name: "Maria Silva", username: "maria.sil" });
  } finally {
    globalThis.fetch = orig;
  }
});
