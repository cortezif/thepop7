import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { buildApp } from "../app.js";

// Gestão de contas/logins (PR #1): equipe + papéis + admin de plataforma.
// Usa app.inject (sem HTTP real). Requer Postgres de pé (test:integration).
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "itest-secret";
process.env.PLATFORM_ADMIN_KEY = process.env.PLATFORM_ADMIN_KEY ?? "itest-platform-key";
const PK = process.env.PLATFORM_ADMIN_KEY;

const prisma = getPrisma();
const app = buildApp();
const slug = `itest-acc-${Date.now()}`;
const ownerEmail = `owner@${slug}.com`;

// Token do owner da loja de teste (bootstrap por signup).
let ownerToken = "";
let ownerId = "";

before(async () => {
  await app.ready();
  const r = await app.inject({
    method: "POST", url: "/auth/signup",
    payload: { storeName: "Loja Contas", slug, name: "Dona", email: ownerEmail, password: "senha123" },
  });
  ownerToken = r.json().token;
  ownerId = r.json().user.id;
});
after(async () => {
  // remove lojas criadas pelo teste (a de signup + a criada via plataforma)
  await prisma.tenant.deleteMany({ where: { slug: { startsWith: slug } } }).catch(() => {});
  await prisma.tenant.deleteMany({ where: { slug: `${slug}-aurora` } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

// ── Equipe ──────────────────────────────────────────────────────────────────

test("owner lista a equipe (só ele no começo)", async () => {
  const r = await app.inject({ method: "GET", url: `/users?tenantSlug=${slug}`, headers: auth(ownerToken) });
  assert.equal(r.statusCode, 200);
  const users = r.json();
  assert.equal(users.length, 1);
  assert.equal(users[0].role, "owner");
});

let operatorId = "";
test("owner cria operador (201) e e-mail duplicado dá 409", async () => {
  const r = await app.inject({
    method: "POST", url: "/users", headers: auth(ownerToken),
    payload: { tenantSlug: slug, name: "Joana", email: `joana@${slug}.com`, role: "operator", password: "joana123" },
  });
  assert.equal(r.statusCode, 201);
  operatorId = r.json().id;
  assert.equal(r.json().role, "operator");

  const dup = await app.inject({
    method: "POST", url: "/users", headers: auth(ownerToken),
    payload: { tenantSlug: slug, name: "Outra", email: `joana@${slug}.com`, role: "operator", password: "x12345" },
  });
  assert.equal(dup.statusCode, 409);
});

let operatorToken = "";
test("operador novo consegue logar", async () => {
  const r = await app.inject({
    method: "POST", url: "/auth/login",
    payload: { email: `joana@${slug}.com`, password: "joana123" },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().user.role, "operator");
  operatorToken = r.json().token;
});

// ── RBAC ──────────────────────────────────────────────────────────────────--

test("operador é bloqueado em GET /users (403)", async () => {
  const r = await app.inject({ method: "GET", url: `/users?tenantSlug=${slug}`, headers: auth(operatorToken) });
  assert.equal(r.statusCode, 403);
});

test("operador é bloqueado em mutação de config (403)", async () => {
  const r = await app.inject({
    method: "POST", url: "/admin/ai-toggle", headers: auth(operatorToken),
    payload: { tenantSlug: slug, enabled: false },
  });
  assert.equal(r.statusCode, 403);
});

test("owner promove operador → admin (PATCH)", async () => {
  const r = await app.inject({
    method: "PATCH", url: `/users/${operatorId}`, headers: auth(ownerToken),
    payload: { tenantSlug: slug, role: "admin" },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().role, "admin");
});

// ── Conta própria ────────────────────────────────────────────────────────--

test("trocar a própria senha: atual errada → 401, certa → 200", async () => {
  const bad = await app.inject({
    method: "POST", url: "/auth/change-password", headers: auth(operatorToken),
    payload: { currentPassword: "errada", newPassword: "nova12345" },
  });
  assert.equal(bad.statusCode, 401);

  const ok = await app.inject({
    method: "POST", url: "/auth/change-password", headers: auth(operatorToken),
    payload: { currentPassword: "joana123", newPassword: "nova12345" },
  });
  assert.equal(ok.statusCode, 200);
});

// ── Guardrails ──────────────────────────────────────────────────────────────

test("owner não pode remover a própria conta (409)", async () => {
  const r = await app.inject({ method: "DELETE", url: `/users/${ownerId}?tenantSlug=${slug}`, headers: auth(ownerToken) });
  assert.equal(r.statusCode, 409);
});

// ── Admin de plataforma ──────────────────────────────────────────────────--

test("GET /platform/tenants sem chave → 401; com chave → lista", async () => {
  const noKey = await app.inject({ method: "GET", url: "/platform/tenants" });
  assert.equal(noKey.statusCode, 401);

  const ok = await app.inject({ method: "GET", url: "/platform/tenants", headers: { "x-platform-key": PK! } });
  assert.equal(ok.statusCode, 200);
  assert.ok(Array.isArray(ok.json()));
});

test("plataforma cria loja + dono; loja suspensa não autentica; slug duplicado → 409", async () => {
  const created = await app.inject({
    method: "POST", url: "/platform/tenants", headers: { "x-platform-key": PK! },
    payload: { storeName: "Aurora", slug: `${slug}-aurora`, ownerName: "Marina", ownerEmail: `marina@${slug}-aurora.com`, password: "marina123" },
  });
  assert.equal(created.statusCode, 201);
  const tid = created.json().id;

  // dono loga na loja nova
  const login1 = await app.inject({
    method: "POST", url: "/auth/login",
    payload: { email: `marina@${slug}-aurora.com`, password: "marina123" },
  });
  assert.equal(login1.statusCode, 200);

  // suspende → login bloqueado
  const susp = await app.inject({
    method: "POST", url: `/platform/tenants/${tid}/status`, headers: { "x-platform-key": PK! },
    payload: { status: "suspended" },
  });
  assert.equal(susp.statusCode, 200);
  const blocked = await app.inject({
    method: "POST", url: "/auth/login",
    payload: { email: `marina@${slug}-aurora.com`, password: "marina123" },
  });
  assert.equal(blocked.statusCode, 401, "loja suspensa não autentica");

  // reativa → login volta
  await app.inject({
    method: "POST", url: `/platform/tenants/${tid}/status`, headers: { "x-platform-key": PK! },
    payload: { status: "active" },
  });
  const login2 = await app.inject({
    method: "POST", url: "/auth/login",
    payload: { email: `marina@${slug}-aurora.com`, password: "marina123" },
  });
  assert.equal(login2.statusCode, 200, "reativada volta a logar");

  // slug duplicado
  const dup = await app.inject({
    method: "POST", url: "/platform/tenants", headers: { "x-platform-key": PK! },
    payload: { storeName: "Aurora 2", slug: `${slug}-aurora`, ownerName: "Xavier", ownerEmail: `x@${slug}-aurora.com`, password: "abc123" },
  });
  assert.equal(dup.statusCode, 409);
});
