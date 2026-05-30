import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { buildApp } from "../app.js";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "itest-secret";

const prisma = getPrisma();
const app = buildApp();
const slug = `itest-cat-${Date.now()}`;
let token = "";
let tenantId = "";

before(async () => {
  await app.ready();
  const r = await app.inject({
    method: "POST", url: "/auth/signup",
    payload: { storeName: "Cat Loja", slug, name: "Op", email: `op@${slug}.com`, password: "senha123" },
  });
  token = r.json().token;
  const t = await prisma.tenant.findUnique({ where: { slug } });
  tenantId = t!.id;
  // Simula um produto vindo do ERP (como o sync faria com a Tray real conectada).
  await prisma.product.create({
    data: {
      tenantId, externalId: "ERP-TEST-1", source: "erp", name: "Produto ERP",
      priceBRL: 100 as any, variants: [{ sku: "ERP-1-U", stock: 3 }] as any,
      media: {} as any, styles: [], occasions: [],
    },
  });
});
after(async () => {
  await prisma.tenant.deleteMany({ where: { slug } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});
const hdr = () => ({ authorization: `Bearer ${token}` });

let manualId = "";

test("lista mostra o produto erp (vindo do banco)", async () => {
  const list = await app.inject({ method: "GET", url: `/catalog/products?tenantSlug=${slug}`, headers: hdr() });
  const erp = list.json().filter((p: any) => p.source === "erp");
  assert.ok(erp.length >= 1, "lista tem produtos erp");
});

test("sync sem Tray conectada → 400 (não injeta mock)", async () => {
  const r = await app.inject({ method: "POST", url: "/catalog/sync", headers: hdr(), payload: { tenantSlug: slug } });
  assert.equal(r.statusCode, 400);
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

test("remove (soft delete) manual e some da lista; erp permanece", async () => {
  const del = await app.inject({ method: "DELETE", url: `/catalog/products/${manualId}?tenantSlug=${slug}`, headers: hdr() });
  assert.equal(del.statusCode, 200);
  const list = await app.inject({ method: "GET", url: `/catalog/products?tenantSlug=${slug}`, headers: hdr() });
  assert.ok(!list.json().some((p: any) => p.id === manualId), "manual removido não aparece");
  assert.ok(list.json().some((p: any) => p.source === "erp"), "erp continua presente (coexistência)");
});

test("sem token → 401", async () => {
  const r = await app.inject({ method: "GET", url: `/catalog/products?tenantSlug=${slug}` });
  assert.equal(r.statusCode, 401);
});

test("by-photo: rejeita string que não é URL nem data URL (400)", async () => {
  const r = await app.inject({ method: "POST", url: "/catalog/barcodes/by-photo", headers: hdr(), payload: { tenantSlug: slug, photoUrls: ["nao-e-url"] } });
  assert.equal(r.statusCode, 400);
});

test("by-photo: aceita data URL na validação (não dá 400)", async () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const r = await app.inject({ method: "POST", url: "/catalog/barcodes/by-photo", headers: hdr(), payload: { tenantSlug: slug, photoUrls: [dataUrl] } });
  assert.notEqual(r.statusCode, 400, "data URL passa na validação (vision pode dar 422, mas não 400)");
});
