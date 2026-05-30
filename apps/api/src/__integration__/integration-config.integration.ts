import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { buildApp } from "../app.js";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "itest-secret";

const prisma = getPrisma();
const app = buildApp();
const slug = `itest-cfg-${Date.now()}`;
let token = "";

before(async () => {
  await app.ready();
  const r = await app.inject({
    method: "POST", url: "/auth/signup",
    payload: { storeName: "Cfg Loja", slug, name: "Op", email: `op@${slug}.com`, password: "senha123" },
  });
  token = r.json().token;
});
after(async () => {
  await prisma.tenant.deleteMany({ where: { slug } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

const hdr = () => ({ authorization: `Bearer ${token}` });

test("GET config: campos do provider, mascarado", async () => {
  const r = await app.inject({ method: "GET", url: `/integrations/tray/config?tenantSlug=${slug}`, headers: hdr() });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.provider, "tray");
  assert.ok(Array.isArray(body.fields) && body.fields.length === 2, "tray tem 2 campos");
  assert.ok(body.fields.every((f: any) => f.key && typeof f.secret === "boolean"));
});

test("POST config: grava credenciais → appConfigured true, segredo mascarado", async () => {
  const r = await app.inject({
    method: "POST", url: `/integrations/tray/config`, headers: hdr(),
    payload: { tenantSlug: slug, values: { consumerKey: "ck_live_123456", consumerSecret: "cs_live_abcdef" } },
  });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.appConfigured, true, "todos os required preenchidos");
  const ck = body.fields.find((f: any) => f.key === "consumerKey");
  assert.equal(ck.source, "db");
  assert.equal(ck.set, true);
  assert.equal(ck.preview, "••••3456", "mostra só os últimos 4 do segredo");
  assert.ok(!JSON.stringify(body).includes("ck_live_123456"), "nunca devolve o segredo em claro");
});

test("status tray reflete appConfigured após gravar", async () => {
  const r = await app.inject({ method: "GET", url: `/integrations/tray?tenantSlug=${slug}`, headers: hdr() });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().appConfigured, true);
});

test("provider desconhecido → 404", async () => {
  const r = await app.inject({ method: "GET", url: `/integrations/foobar/config?tenantSlug=${slug}`, headers: hdr() });
  assert.equal(r.statusCode, 404);
});

test("limpar credencial (valor vazio) remove do banco", async () => {
  const r = await app.inject({
    method: "POST", url: `/integrations/tray/config`, headers: hdr(),
    payload: { tenantSlug: slug, values: { consumerKey: "", consumerSecret: "" } },
  });
  assert.equal(r.statusCode, 200);
  const ck = r.json().fields.find((f: any) => f.key === "consumerKey");
  assert.notEqual(ck.source, "db", "não está mais salvo no banco da loja");
});

test("isolamento: sem token → 401", async () => {
  const r = await app.inject({ method: "GET", url: `/integrations/tray/config?tenantSlug=${slug}` });
  assert.equal(r.statusCode, 401);
});
