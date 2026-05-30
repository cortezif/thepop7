import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";

const app = buildApp();
before(async () => { await app.ready(); });
after(async () => { await app.close(); });

test("www.<host> → 301 para <host> sem www, preservando o path", async () => {
  const r = await app.inject({ method: "GET", url: "/health", headers: { host: "www.hub.adviser.api.br" } });
  assert.equal(r.statusCode, 301);
  assert.equal(r.headers.location, "https://hub.adviser.api.br/health");
});

test("host sem www passa direto (sem redirect)", async () => {
  const r = await app.inject({ method: "GET", url: "/health", headers: { host: "hub.adviser.api.br" } });
  assert.notEqual(r.statusCode, 301);
});

test("domínio railway.app não é afetado", async () => {
  const r = await app.inject({ method: "GET", url: "/health", headers: { host: "thepopapi-production.up.railway.app" } });
  assert.notEqual(r.statusCode, 301);
});
