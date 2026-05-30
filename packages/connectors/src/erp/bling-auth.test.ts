import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBlingTokenResponse, buildBlingAuthorizeUrl } from "./bling-auth.js";

test("parseBlingTokenResponse: resposta válida", () => {
  const t = parseBlingTokenResponse({
    access_token: "acc-123", refresh_token: "ref-456", expires_in: 21600, token_type: "Bearer",
  });
  assert.equal(t.accessToken, "acc-123");
  assert.equal(t.refreshToken, "ref-456");
  assert.equal(t.expiresIn, 21600);
});

test("parseBlingTokenResponse: expires_in ausente → default 6h", () => {
  const t = parseBlingTokenResponse({ access_token: "x" });
  assert.equal(t.expiresIn, 21600);
  assert.equal(t.refreshToken, "");
});

test("parseBlingTokenResponse: sem access_token → erro com a mensagem do Bling", () => {
  assert.throws(
    () => parseBlingTokenResponse({ error: "invalid_grant", error_description: "code expirado" }),
    /Bling auth falhou: code expirado/,
  );
});

test("buildBlingAuthorizeUrl: monta authorize com response_type/client_id/state", () => {
  const url = buildBlingAuthorizeUrl({ clientId: "cli-1", state: "thepop7", redirectUri: "https://hub.adviser.api.br/api/auth/bling/callback" });
  const u = new URL(url);
  assert.equal(u.pathname.endsWith("/oauth/authorize"), true);
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("client_id"), "cli-1");
  assert.equal(u.searchParams.get("state"), "thepop7");
  assert.equal(u.searchParams.get("redirect_uri"), "https://hub.adviser.api.br/api/auth/bling/callback");
});
