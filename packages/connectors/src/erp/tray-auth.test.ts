import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrayTokenResponse, parseTrayDate, buildTrayAuthorizeUrl } from "./tray-auth.js";

test("parseTrayTokenResponse: mapeia tokens + datas + store_id", () => {
  const t = parseTrayTokenResponse({
    access_token: "ACC",
    refresh_token: "REF",
    store_id: 12345,
    date_expiration_access_token: "2026-06-01 12:00:00",
    date_expiration_refresh_token: "2026-07-01 12:00:00",
  });
  assert.equal(t.accessToken, "ACC");
  assert.equal(t.refreshToken, "REF");
  assert.equal(t.storeId, "12345");
  assert.equal(t.accessExpiresAt?.getFullYear(), 2026);
  assert.equal(t.accessExpiresAt?.getMonth(), 5); // junho (0-based)
  assert.ok(t.refreshExpiresAt instanceof Date);
});

test("parseTrayTokenResponse: sem access_token → erro com a mensagem da Tray", () => {
  assert.throws(
    () => parseTrayTokenResponse({ message: "code inválido" }),
    /Tray auth falhou: code inválido/,
  );
});

test("parseTrayDate: formato Tray e inválidos", () => {
  assert.equal(parseTrayDate("2026-06-01 09:30:00")?.toISOString().slice(0, 10), "2026-06-01");
  assert.equal(parseTrayDate(""), undefined);
  assert.equal(parseTrayDate("não é data"), undefined);
  assert.equal(parseTrayDate(undefined), undefined);
});

test("buildTrayAuthorizeUrl: monta URL de autorização (sem barra dupla)", () => {
  const url = buildTrayAuthorizeUrl({
    apiAddress: "https://loja.commercesuite.com.br/web_api/",
    consumerKey: "CK",
    callbackUrl: "https://app.thepop7/api/auth/tray/callback",
  });
  assert.match(url, /^https:\/\/loja\.commercesuite\.com\.br\/web_api\/auth\?/);
  assert.match(url, /consumer_key=CK/);
  assert.match(url, /response_type=code/);
  assert.match(url, /callback=https%3A%2F%2Fapp\.thepop7/);
});
