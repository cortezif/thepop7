import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { recordNps, npsSummary } from "../services/nps.js";
import { rankQuotes } from "../services/purchasing-service.js";
import { listCampaigns, createCampaign, previewSegment } from "../services/broadcast-service.js";
import { cashbackBalance } from "../services/cashback-service.js";
import { marketingReport } from "../services/marketing-report-service.js";
import { listContacts, contactStats, createContactManual } from "../services/contact-service.js";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "itest-secret";

const prisma = getPrisma();
const sfx = Date.now();
let tA = "", tB = "", reqB = "", contactB = "";

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

  // Marketing/CRM da loja B (ADR-031): contato + cashback + campanha.
  const c = await createContactManual(tB, { name: "CliB", phone: "+5511988887777", consentLGPD: true });
  contactB = c.id;
  await prisma.cashbackEntry.create({ data: { tenantId: tB, contactId: contactB, kind: "accrual", amountBRL: 15, remainingBRL: 15, expiresAt: new Date(Date.now() + 30 * 864e5) } });
  await createCampaign(tB, { title: "Promo B", message: "oi", channels: ["whatsapp"] });
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

test("campanhas (ADR-031) não vazam entre lojas", async () => {
  assert.equal((await listCampaigns(tA)).length, 0, "A não vê a campanha da B");
  assert.equal((await listCampaigns(tB)).length, 1, "B vê a própria");
});

test("cashback (ADR-031) é por loja", async () => {
  assert.equal(await cashbackBalance(tA, contactB), 0, "A não enxerga o saldo do cliente da B");
  assert.equal(await cashbackBalance(tB, contactB), 15, "B enxerga o próprio");
  assert.equal((await marketingReport(tA)).cashback.accruedBRL, 0, "relatório de A não soma cashback da B");
  assert.equal((await marketingReport(tB)).cashback.accruedBRL, 15);
});

test("contatos/CRM (ADR-031) não vazam entre lojas", async () => {
  assert.equal((await listContacts(tA)).length, 0, "A não vê o contato da B");
  assert.equal((await listContacts(tB)).length, 1, "B vê o próprio");
  assert.equal((await contactStats(tA)).total, 0);
  assert.equal((await previewSegment(tA, "todos")).total, 0, "segmento de A não pega contatos da B");
  assert.equal((await previewSegment(tB, "todos")).total, 1);
});
