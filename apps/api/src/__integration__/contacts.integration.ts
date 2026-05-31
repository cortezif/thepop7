import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrisma, withTenant } from "@hubadvisor/db";
import { withTestTenant } from "./helpers.js";
import { listContacts, contactStats, createContactManual, updateContactConsent } from "../services/contact-service.js";
import { resolveContact } from "../services/identity-service.js";

// Cadastro de clientes / CRM (ADR-031): criação cifrada+dedup, agregados
// (cashback/pedidos) e gestão de consentimento. test:integration (Postgres).

const prisma = getPrisma();

test("CRM: cria (dedup), agrega cashback/pedidos e gere opt-out", async () => {
  await withTestTenant(async (tenantId) => {
    // Cadastro manual com consentimento + dedup por telefone.
    const a = await createContactManual(tenantId, { name: "Ana", phone: "5583999990001", email: "ana@ex.com", consentLGPD: true });
    assert.equal(a.created, true);
    const again = await createContactManual(tenantId, { name: "Ana 2", phone: "5583999990001" });
    assert.equal(again.created, false, "mesmo telefone não duplica");
    assert.equal(again.id, a.id);

    // Cashback ativo + 1 pedido para os agregados.
    await prisma.cashbackEntry.create({ data: { tenantId, contactId: a.id, kind: "accrual", amountBRL: 15, remainingBRL: 15, expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
    await prisma.order.create({ data: { tenantId, contactId: a.id, status: "paid", subtotalBRL: 100, shippingBRL: 0, totalBRL: 100 } });

    const list = await listContacts(tenantId);
    const row = list.find((c) => c.id === a.id)!;
    assert.equal(row.cashbackBRL, 15);
    assert.equal(row.ordersCount, 1);
    assert.equal(row.totalSpentBRL, 100);
    assert.ok(row.phoneMasked?.endsWith("0001"), "telefone mascarado mostra final");
    assert.ok(!row.optOuts.includes("marketing"));

    const stats = await contactStats(tenantId);
    assert.equal(stats.total, 1);
    assert.equal(stats.withCashback, 1);
    assert.equal(stats.reachableWhatsapp, 1, "tem telefone e não optou por sair");

    // Opt-out de marketing → some do alcance.
    await updateContactConsent(tenantId, a.id, { optOuts: ["marketing"] });
    const stats2 = await contactStats(tenantId);
    assert.equal(stats2.optedOutMarketing, 1);
    assert.equal(stats2.reachableWhatsapp, 0);

    await prisma.cashbackEntry.deleteMany({ where: { tenantId } });
  });
});

test("auto-cadastro: contato do WhatsApp/IG entra no CRM com nome e canal de origem (ADR-034)", async () => {
  await withTestTenant(async (tenantId) => {
    // Chegou pelo WhatsApp com nome de perfil → cria já cadastrado.
    const wa = await withTenant(tenantId, (tx) => resolveContact(tx, tenantId, { phone: "+5583999990001", name: "Maria do WhatsApp", preferredChannel: "whatsapp" }));
    // Chegou pelo Instagram (sem nome) → cria com canal instagram.
    await withTenant(tenantId, (tx) => resolveContact(tx, tenantId, { igHandle: "ig_user_123", preferredChannel: "instagram" }));

    const list = await listContacts(tenantId);
    assert.equal(list.length, 2, "ambos no cadastro de clientes");
    const maria = list.find((c) => c.id === wa.id)!;
    assert.equal(maria.name, "Maria do WhatsApp");
    assert.equal(maria.channel, "whatsapp");
    const ig = list.find((c) => c.igHandle === "ig_user_123")!;
    assert.equal(ig.channel, "instagram");

    // Reentrada pelo mesmo telefone não duplica e não apaga o canal já gravado.
    await withTenant(tenantId, (tx) => resolveContact(tx, tenantId, { phone: "+5583999990001", preferredChannel: "whatsapp" }));
    assert.equal((await listContacts(tenantId)).length, 2, "não duplicou");
  });
});
