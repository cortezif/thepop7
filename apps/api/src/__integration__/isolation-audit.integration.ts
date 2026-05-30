import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { recordNps, npsSummary } from "../services/nps.js";
import { rankQuotes } from "../services/purchasing-service.js";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "itest-secret";

const prisma = getPrisma();
const sfx = Date.now();
let tA = "", tB = "", reqB = "";

before(async () => {
  const a = await prisma.tenant.create({ data: { slug: `itest-isoa-${sfx}`, name: "A", status: "active", agentPersona: "Maya", agentTone: "x", policies: {} } });
  const b = await prisma.tenant.create({ data: { slug: `itest-isob-${sfx}`, name: "B", status: "active", agentPersona: "Maya", agentTone: "x", policies: {} } });
  tA = a.id; tB = b.id;
  // NPS: A=10 (promotor), B=0 (detrator)
  await recordNps(tA, { score: 10, kind: "geral" });
  await recordNps(tB, { score: 0, kind: "geral" });
  // Compra + cotação da loja B
  const sup = await prisma.supplier.create({ data: { tenantId: tB, name: "Forn B", active: true } });
  const pr = await prisma.purchaseRequest.create({ data: { tenantId: tB, status: "quoted", items: [{ description: "x", quantity: 1 }] as any } });
  reqB = pr.id;
  await prisma.quote.create({ data: { tenantId: tB, requestId: pr.id, supplierId: sup.id, items: [{ description: "x", unitPriceBRL: 10, quantity: 1 }] as any, totalBRL: 10 as any, leadTimeDays: 5 } });
});
after(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { in: [`itest-isoa-${sfx}`, `itest-isob-${sfx}`] } } }).catch(() => {});
  await prisma.$disconnect();
});

test("npsSummary só conta o NPS da própria loja", async () => {
  const sumA = await npsSummary(tA);
  assert.equal(sumA.geral.responses, 1, "A vê só a própria resposta (não soma a de B)");
  assert.equal(sumA.geral.promotores, 1);
  assert.equal(sumA.geral.detratores, 0, "não pega o detrator da loja B");
});

test("rankQuotes não ranqueia cotação de outra loja", async () => {
  const crossed = await rankQuotes(tA, reqB); // loja A tentando a requisição da B
  assert.deepEqual(crossed.ranked, [], "A não acessa as cotações da B");
  const own = await rankQuotes(tB, reqB);
  assert.equal(own.ranked.length, 1, "B ranqueia a própria");
});
