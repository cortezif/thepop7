import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { buildApp } from "../app.js";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "itest-secret";

const prisma = getPrisma();
const app = buildApp();
const slugA = `itest-pcha-${Date.now()}`;
const slugB = `itest-pchb-${Date.now()}`;
let tokenA = "", tokenB = "", reqIdB = "";

before(async () => {
  await app.ready();
  const a = await app.inject({ method: "POST", url: "/auth/signup", payload: { storeName: "Loja A", slug: slugA, name: "Op", email: `op@${slugA}.com`, password: "senha123" } });
  tokenA = a.json().token;
  const b = await app.inject({ method: "POST", url: "/auth/signup", payload: { storeName: "Loja B", slug: slugB, name: "Op", email: `op@${slugB}.com`, password: "senha123" } });
  tokenB = b.json().token;
  const tB = await prisma.tenant.findUnique({ where: { slug: slugB } });
  // Requisição de compra pertencente à loja B
  const r = await prisma.purchaseRequest.create({
    data: { tenantId: tB!.id, status: "open", reason: "teste", items: [{ description: "Item B", quantity: 2, sku: "B-1" }] as any },
  });
  reqIdB = r.id;
});
after(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

test("loja A NÃO vê requisições de compra da loja B", async () => {
  const r = await app.inject({ method: "GET", url: `/purchasing/requests?tenantSlug=${slugA}`, headers: { authorization: `Bearer ${tokenA}` } });
  assert.equal(r.statusCode, 200);
  assert.ok(!r.json().some((x: any) => x.id === reqIdB), "não deve listar a requisição da loja B");
});

test("loja B vê a própria requisição", async () => {
  const r = await app.inject({ method: "GET", url: `/purchasing/requests?tenantSlug=${slugB}`, headers: { authorization: `Bearer ${tokenB}` } });
  assert.ok(r.json().some((x: any) => x.id === reqIdB), "loja B vê a própria");
});

test("receiving da requisição da loja B sob a loja A → 404 (isolado)", async () => {
  const r = await app.inject({ method: "GET", url: `/purchasing/requests/${reqIdB}/receiving?tenantSlug=${slugA}`, headers: { authorization: `Bearer ${tokenA}` } });
  assert.equal(r.statusCode, 404);
});

test("receiving da própria requisição (loja B) → 200", async () => {
  const r = await app.inject({ method: "GET", url: `/purchasing/requests/${reqIdB}/receiving?tenantSlug=${slugB}`, headers: { authorization: `Bearer ${tokenB}` } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().requestId, reqIdB);
});
