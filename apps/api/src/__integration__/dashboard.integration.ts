import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { withTestTenant } from "./helpers.js";
import { liveDashboard, ensureTvToken, liveDashboardByToken, resetTvToken, disableTvToken } from "../services/dashboard-service.js";

// Wallboard de TV (ADR-040): agrega o dia (vendas/pagamentos/atendimento/entrega)
// e expõe via link público por token. test:integration (Postgres).

const prisma = getPrisma();

test("wallboard agrega vendas, pagamentos, atendimento e entregas do dia", async () => {
  await withTestTenant(async (tenantId) => {
    const now = new Date();
    const c = await prisma.contact.create({ data: { tenantId, name: "Cliente TV" } });

    // 1 pago hoje (R$200), 1 criado pendente de aprovação, 1 a separar (paid s/ paidAt hoje? não:
    // "pago hoje" usa paidAt; "a separar" usa status). Montamos cenários distintos:
    await prisma.order.create({ data: { tenantId, contactId: c.id, status: "paid", subtotalBRL: 200, totalBRL: 200, paidAt: now } }); // venda de hoje + a separar
    await prisma.order.create({ data: { tenantId, contactId: c.id, status: "created", subtotalBRL: 80, totalBRL: 80, metadata: { pendingApproval: true } as any } });
    await prisma.order.create({ data: { tenantId, contactId: c.id, status: "in_transit", subtotalBRL: 50, totalBRL: 50 } });
    await prisma.order.create({ data: { tenantId, contactId: c.id, status: "delivered", subtotalBRL: 90, totalBRL: 90, deliveredAt: now } });

    // Atendimento: 2 ativos, 1 aguardando humano.
    await prisma.conversation.createMany({ data: [
      { tenantId, contactId: c.id, channel: "whatsapp", status: "active" },
      { tenantId, contactId: c.id, channel: "instagram", status: "active" },
      { tenantId, contactId: c.id, channel: "whatsapp", status: "handed_off", handoffReason: "humano" },
    ] });

    const d = await liveDashboard(tenantId);
    assert.equal(d.today.salesBRL, 200, "vendas pagas hoje");
    assert.equal(d.today.ordersPaid, 1);
    assert.equal(d.today.ticketBRL, 200);
    assert.equal(d.payments.pendingApproval, 1);
    assert.equal(d.payments.awaitingPayment, 1, "1 criado/sem pagamento");
    assert.equal(d.fulfillment.toShip, 1, "o pago entra em 'a separar'");
    assert.equal(d.fulfillment.inTransit, 1);
    assert.equal(d.fulfillment.deliveredToday, 1);
    assert.equal(d.attendance.active, 2);
    assert.equal(d.attendance.waitingHuman, 1);
    assert.ok(d.recentOrders.length >= 4);
    assert.ok(d.attendingNow.length >= 3);
    assert.equal(d.recentDeliveries[0]?.customer, "Cliente TV");
  });
});

test("link público por token: resolve a loja, isola e revoga", async () => {
  await withTestTenant(async (tenantId) => {
    const token = await ensureTvToken(tenantId);
    assert.ok(token.length >= 16);
    assert.equal(await ensureTvToken(tenantId), token, "idempotente: não regenera");

    const byToken = await liveDashboardByToken(token);
    assert.ok(byToken, "token válido devolve o painel");

    // Token inválido / curto → null (não vaza).
    assert.equal(await liveDashboardByToken("inexistente-12345678"), null);
    assert.equal(await liveDashboardByToken("x"), null);

    // Reset invalida o anterior.
    const novo = await resetTvToken(tenantId);
    assert.notEqual(novo, token);
    assert.equal(await liveDashboardByToken(token), null, "token antigo revogado");
    assert.ok(await liveDashboardByToken(novo));

    // Desativar remove o link.
    await disableTvToken(tenantId);
    assert.equal(await liveDashboardByToken(novo), null);
  });
});
