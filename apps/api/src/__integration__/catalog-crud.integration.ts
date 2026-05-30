import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { buildApp } from "../app.js";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "itest-secret";

const prisma = getPrisma();
const app = buildApp();
const slug = `itest-cat-${Date.now()}`;
let token = "";

before(async () => {
  await app.ready();
  const r = await app.inject({
    method: "POST", url: "/auth/signup",
    payload: { storeName: "Cat Loja", slug, name: "Op", email: `op@${slug}.com`, password: "senha123" },
  });
  token = r.json().token;
});
after(async () => {
  await prisma.tenant.deleteMany({ where: { slug } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});
const hdr = () => ({ authorization: `Bearer ${token}` });

let manualId = "";

test("sync do ERP popula produtos source=erp", async () => {
  const r = await app.inject({ method: "POST", url: "/catalog/sync", headers: hdr(), payload: { tenantSlug: slug } });
  assert.equal(r.statusCode, 200);
  assert.ok(r.json().upserted >= 1, "sincronizou ao menos 1 do mock ERP");
  const list = await app.inject({ method: "GET", url: `/catalog/products?tenantSlug=${slug}`, headers: hdr() });
  const erp = list.json().filter((p: any) => p.source === "erp");
  assert.ok(erp.length >= 1, "lista tem produtos erp");
});

test("cria produto manual", async () => {
  const r = await app.inject({
    method: "POST", url: "/catalog/products", headers: hdr(),
    payload: { tenantSlug: slug, name: "Bolsa Couro", priceBRL: 199.9, costBRL: 80, variants: [{ sku: "BOLSA-UNICA", color: "Caramelo", stock: 5 }] },
  });
  assert.equal(r.statusCode, 200);
  const p = r.json();
  assert.equal(p.source, "manual");
  assert.ok(p.externalId.startsWith("manual-"));
  manualId = p.id;
});

test("lista unifica manual + erp", async () => {
  const r = await app.inject({ method: "GET", url: `/catalog/products?tenantSlug=${slug}`, headers: hdr() });
  const list = r.json();
  assert.ok(list.some((p: any) => p.id === manualId && p.source === "manual"));
  assert.ok(list.some((p: any) => p.source === "erp"));
});

test("edita produto manual", async () => {
  const r = await app.inject({ method: "PUT", url: `/catalog/products/${manualId}`, headers: hdr(), payload: { tenantSlug: slug, priceBRL: 249.9 } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().priceBRL, 249.9);
});

test("editar produto ERP é bloqueado (409)", async () => {
  const list = await app.inject({ method: "GET", url: `/catalog/products?tenantSlug=${slug}`, headers: hdr() });
  const erp = list.json().find((p: any) => p.source === "erp");
  const r = await app.inject({ method: "PUT", url: `/catalog/products/${erp.id}`, headers: hdr(), payload: { tenantSlug: slug, name: "tentativa" } });
  assert.equal(r.statusCode, 409);
});

test("remove (soft delete) manual e some da lista; novo sync não o ressuscita", async () => {
  const del = await app.inject({ method: "DELETE", url: `/catalog/products/${manualId}?tenantSlug=${slug}`, headers: hdr() });
  assert.equal(del.statusCode, 200);
  const list1 = await app.inject({ method: "GET", url: `/catalog/products?tenantSlug=${slug}`, headers: hdr() });
  assert.ok(!list1.json().some((p: any) => p.id === manualId), "manual removido não aparece");
  // sync de novo não toca nos manuais nem reativa
  await app.inject({ method: "POST", url: "/catalog/sync", headers: hdr(), payload: { tenantSlug: slug } });
  const list2 = await app.inject({ method: "GET", url: `/catalog/products?tenantSlug=${slug}`, headers: hdr() });
  assert.ok(!list2.json().some((p: any) => p.id === manualId), "continua removido após sync");
  assert.ok(list2.json().some((p: any) => p.source === "erp"), "erp continua presente");
});

test("sem token → 401", async () => {
  const r = await app.inject({ method: "GET", url: `/catalog/products?tenantSlug=${slug}` });
  assert.equal(r.statusCode, 401);
});
