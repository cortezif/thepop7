import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { withTestTenant } from "./helpers.js";
import { marketingReport } from "../services/marketing-report-service.js";

// Relatório de marketing/fidelidade (ADR-031): consolida o razão de cashback
// (sinais +/−) e o desempenho de campanhas. test:integration (Postgres).

const prisma = getPrisma();

test("relatório: consolida cashback (acumulado/resgatado/expirado/passivo) e campanhas", async () => {
  await withTestTenant(async (tenantId) => {
    const c = await prisma.contact.create({ data: { tenantId, name: "Ana" } });
    const future = new Date(Date.now() + 40 * 86_400_000);
    const soon = new Date(Date.now() + 10 * 86_400_000);
    // Razão: creditou 100 (40 ainda vivos vencendo em 40d + 10 vivos vencendo em 10d),
    // resgatou 30 (negativo), expirou 20 (negativo).
    await prisma.cashbackEntry.createMany({ data: [
      { tenantId, contactId: c.id, kind: "accrual", amountBRL: 50, remainingBRL: 40, expiresAt: future },
      { tenantId, contactId: c.id, kind: "accrual", amountBRL: 50, remainingBRL: 10, expiresAt: soon },
      { tenantId, contactId: c.id, kind: "redeem", amountBRL: -30, remainingBRL: 0 },
      { tenantId, contactId: c.id, kind: "expire", amountBRL: -20, remainingBRL: 0 },
    ] });
    await prisma.marketingCampaign.create({ data: {
      tenantId, title: "T", message: "M", channels: ["whatsapp", "sms"], status: "enviada",
      recipients: 5, sentWhatsapp: 5, sentEmail: 0, sentSms: 3,
    } });

    const r = await marketingReport(tenantId);
    assert.equal(r.cashback.accruedBRL, 100);
    assert.equal(r.cashback.redeemedBRL, 30, "valor absoluto do resgate");
    assert.equal(r.cashback.expiredBRL, 20);
    assert.equal(r.cashback.activeBalanceBRL, 50, "40 + 10 ainda vivos");
    assert.equal(r.cashback.expiring30BRL, 10, "só o que vence em 10d entra na janela de 30d");
    assert.equal(r.cashback.redemptionRate, 0.3);
    assert.equal(r.cashback.contactsWithBalance, 1);
    assert.equal(r.campaigns.sent, 1);
    assert.equal(r.campaigns.recipients, 5);
    assert.equal(r.campaigns.sentWhatsapp, 5);
    assert.equal(r.campaigns.sentSms, 3);

    await prisma.cashbackEntry.deleteMany({ where: { tenantId } });
    await prisma.marketingCampaign.deleteMany({ where: { tenantId } });
  });
});
