import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCredential, credentialFromContext, runWithCredentials, enterCredentials } from "./credentials.js";

test("sem contexto: resolveCredential cai na env var", () => {
  process.env.__TEST_WA_TOKEN = "env-token";
  assert.equal(resolveCredential("whatsapp", "accessToken", "__TEST_WA_TOKEN"), "env-token");
  assert.equal(credentialFromContext("whatsapp", "accessToken"), undefined);
});

test("com contexto: valor da loja tem prioridade sobre a env", () => {
  process.env.__TEST_WA_TOKEN = "env-token";
  const out = runWithCredentials({ whatsapp: { accessToken: "loja-token" } }, () => {
    return {
      resolved: resolveCredential("whatsapp", "accessToken", "__TEST_WA_TOKEN"),
      ctx: credentialFromContext("whatsapp", "accessToken"),
    };
  });
  assert.equal(out.resolved, "loja-token", "contexto vence a env");
  assert.equal(out.ctx, "loja-token");
});

test("campo ausente no contexto ainda cai na env", () => {
  process.env.__TEST_WA_TOKEN = "env-token";
  const out = runWithCredentials({ whatsapp: { phoneNumberId: "123" } }, () =>
    resolveCredential("whatsapp", "accessToken", "__TEST_WA_TOKEN"),
  );
  assert.equal(out, "env-token");
});

test("contexto vazio não sobrepõe (mantém env)", () => {
  process.env.__TEST_WA_TOKEN = "env-token";
  const out = runWithCredentials({}, () => resolveCredential("whatsapp", "accessToken", "__TEST_WA_TOKEN"));
  assert.equal(out, "env-token");
});

test("enterCredentials fixa no contexto async atual", async () => {
  await runWithCredentials({}, async () => {
    enterCredentials({ anthropic: { apiKey: "sk-loja" } });
    await Promise.resolve();
    assert.equal(credentialFromContext("anthropic", "apiKey"), "sk-loja");
  });
});

test("fora de qualquer contexto, credentialFromContext é undefined", () => {
  assert.equal(credentialFromContext("anthropic", "apiKey"), undefined);
});
