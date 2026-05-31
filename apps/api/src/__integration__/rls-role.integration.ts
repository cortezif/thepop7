import { test, before, after } from "node:test";
import assert from "node:assert/strict";

// Hardening do RLS (ADR-002): com APP_DB_ROLE definido, cada transação
// tenant-scoped baixa pra um papel NOBYPASSRLS e o RLS isola de verdade —
// mesmo SEM filtro `tenantId` no código. Requer Postgres + rls.sql aplicado
// (cria o papel `hubadvisor_app` e os grants).
//
// IMPORTANTE: setamos a env ANTES de importar @hubadvisor/db (o módulo lê
// APP_DB_ROLE no load). Por isso o import é dinâmico, dentro do before().
process.env.APP_DB_ROLE = process.env.APP_DB_ROLE ?? "hubadvisor_app";

let getPrisma: typeof import("@hubadvisor/db").getPrisma;
let withTenant: typeof import("@hubadvisor/db").withTenant;
let prisma: import("@hubadvisor/db").PrismaClient;

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const slugA = `itest-rls-a-${stamp}`;
const slugB = `itest-rls-b-${stamp}`;
let tA = "", tB = "", evA = "", evB = "";

before(async () => {
  const db = await import("@hubadvisor/db");
  getPrisma = db.getPrisma; withTenant = db.withTenant;
  prisma = getPrisma();
  // Setup como o usuário da conexão (postgres) — bypassa RLS, popula os dois tenants.
  const a = await prisma.tenant.create({ data: { slug: slugA, name: "RLS A", status: "active", agentPersona: "Maya" } });
  const b = await prisma.tenant.create({ data: { slug: slugB, name: "RLS B", status: "active", agentPersona: "Maya" } });
  tA = a.id; tB = b.id;
  evA = (await prisma.domainEvent.create({ data: { tenantId: tA, type: "itest", payload: {} } })).id;
  evB = (await prisma.domainEvent.create({ data: { tenantId: tB, type: "itest", payload: {} } })).id;
});

after(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } }).catch(() => {});
  await prisma.$disconnect();
});

test("leitura sem filtro dentro de withTenant(A) só enxerga A", async () => {
  const rows = await withTenant(tA, async (tx) => tx.domainEvent.findMany({ where: { type: "itest" } }));
  assert.ok(rows.length >= 1, "vê os próprios eventos");
  assert.ok(rows.every((r) => r.tenantId === tA), "nenhum evento de outro tenant vaza");
});

test("evento de B é invisível dentro de withTenant(A)", async () => {
  const found = await withTenant(tA, async (tx) => tx.domainEvent.findUnique({ where: { id: evB } }));
  assert.equal(found, null, "RLS esconde a linha de outro tenant");
});

test("escrita cross-tenant dentro de withTenant(A) é bloqueada (WITH CHECK)", async () => {
  await assert.rejects(
    () => withTenant(tA, async (tx) => tx.domainEvent.create({ data: { tenantId: tB, type: "itest-bad", payload: {} } })),
    "inserir com tenantId de outra loja viola a policy",
  );
});

test("getPrisma direto (cross-tenant intencional) enxerga os dois", async () => {
  const rows = await prisma.domainEvent.findMany({ where: { id: { in: [evA, evB] } } });
  assert.equal(rows.length, 2, "caminho admin/cross-tenant segue como postgres");
});
