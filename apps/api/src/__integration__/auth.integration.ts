import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@thepop/db";
import { buildApp } from "../app.js";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "itest-secret";

const prisma = getPrisma();
const app = buildApp();
const slug = `itest-auth-${Date.now()}`;

before(async () => { await app.ready(); });
after(async () => {
  await prisma.tenant.deleteMany({ where: { slug } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

test("signup cria loja e devolve token", async () => {
  const r = await app.inject({
    method: "POST", url: "/auth/signup",
    payload: { storeName: "Loja Integração", slug, name: "Op", email: `op@${slug}.com`, password: "senha123" },
  });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.tenantSlug, slug);
  assert.ok(body.token);
});

test("isolamento: token da loja nova acessa a própria (200) e é bloqueado em thepop7 (403)", async () => {
  const signup = await app.inject({
    method: "POST", url: "/auth/signup",
    payload: { storeName: "Loja B", slug: `${slug}-b`, name: "Op", email: `op@${slug}-b.com`, password: "senha123" },
  });
  const token = signup.json().token;

  const own = await app.inject({ method: "GET", url: `/metrics/daily?tenantSlug=${slug}-b`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(own.statusCode, 200, "vê a própria loja");

  const cross = await app.inject({ method: "GET", url: `/metrics/daily?tenantSlug=thepop7`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(cross.statusCode, 403, "bloqueado em outra loja");

  await prisma.tenant.deleteMany({ where: { slug: `${slug}-b` } }).catch(() => {});
});

test("rota protegida sem token → 401", async () => {
  const r = await app.inject({ method: "GET", url: `/metrics/daily?tenantSlug=${slug}` });
  assert.equal(r.statusCode, 401);
});

test("slug duplicado → 409", async () => {
  const r = await app.inject({
    method: "POST", url: "/auth/signup",
    payload: { storeName: "Dup", slug, name: "Op", email: `dup@${slug}.com`, password: "senha123" },
  });
  assert.equal(r.statusCode, 409);
});

test("rota inbound (conversations/incoming) NÃO exige auth", async () => {
  // Payload inválido (sem text) → para na validação (400), provando que a rota é
  // alcançável SEM token (não 401) sem acionar o agente/LLM.
  const r = await app.inject({
    method: "POST", url: "/conversations/incoming",
    payload: { tenantSlug: slug, channel: "manual", contact: { name: "X" } },
  });
  assert.equal(r.statusCode, 400, "alcança a validação sem auth");
});
