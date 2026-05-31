import { test } from "node:test";
import assert from "node:assert/strict";
process.env.USE_MOCK_CONNECTORS = "true"; // força conectores mock no envio
import { getPrisma, encryptPII } from "@hubadvisor/db";
import { withTestTenant } from "./helpers.js";
import { previewSegment, createCampaign, sendCampaign, sendCashbackNudges } from "../services/broadcast-service.js";

// Broadcast de promoções (ADR-031 fase 2): segmento respeita opt-out de marketing
// e o envio usa conectores mock (sem credencial). test:integration (Postgres).

const prisma = getPrisma();

test("broadcast: segmenta (exclui opt-out de marketing) e envia por canal disponível", async () => {
  await withTestTenant(async (tenantId) => {
    // A: telefone, consentido → elegível
    await prisma.contact.create({ data: { tenantId, name: "Ana", phone: encryptPII("5583999990001") } });
    // B: optou por sair de marketing → excluído
    await prisma.contact.create({ data: { tenantId, name: "Bia", phone: encryptPII("5583999990002"), optOuts: ["marketing"] } });
    // C: só e-mail → elegível, mas sem telefone
    await prisma.contact.create({ data: { tenantId, name: "Cao", email: encryptPII("cao@ex.com") } });

    const seg = await previewSegment(tenantId, {});
    assert.equal(seg.total, 2, "Ana + Cao (Bia excluída por opt-out)");
    assert.equal(seg.withPhone, 1, "só Ana tem telefone");
    assert.equal(seg.withEmail, 1, "só Cao tem e-mail");

    const camp = await createCampaign(tenantId, {
      title: "Cashback vencendo", message: "Aproveite seu cashback!", channels: ["whatsapp", "sms"],
    });
    assert.equal(camp.status, "rascunho");

    const sent = await sendCampaign(tenantId, camp.id);
    assert.equal(sent.status, "enviada");
    assert.equal(sent.recipients, 2);
    assert.equal(sent.sentWhatsapp, 1, "só Ana recebe WhatsApp (mock ok)");
    assert.equal(sent.sentSms, 1, "só Ana recebe SMS (mock ok)");
    assert.equal(sent.skipped, 1, "Cao sem canal alcançável (campanha só wpp/sms)");

    // reenvio bloqueado
    await assert.rejects(() => sendCampaign(tenantId, camp.id), /já enviada/);

    await prisma.marketingCampaign.deleteMany({ where: { tenantId } });
  });
});

test("nudge: lembra cashback a vencer uma vez e não reenvia (idempotente)", async () => {
  await withTestTenant(async (tenantId) => {
    const ana = await prisma.contact.create({ data: { tenantId, name: "Ana", phone: encryptPII("5583999990001") } });
    // accrual vencendo em 3 dias (dentro da janela de 5)
    await prisma.cashbackEntry.create({
      data: { tenantId, contactId: ana.id, kind: "accrual", amountBRL: 25, remainingBRL: 25, expiresAt: new Date(Date.now() + 3 * 86_400_000) },
    });
    // accrual que vence só daqui a 30 dias → fora da janela
    await prisma.cashbackEntry.create({
      data: { tenantId, contactId: ana.id, kind: "accrual", amountBRL: 10, remainingBRL: 10, expiresAt: new Date(Date.now() + 30 * 86_400_000) },
    });

    const r1 = await sendCashbackNudges(tenantId, 5);
    assert.equal(r1.contacts, 1, "Ana lembrada");
    assert.equal(r1.sentWhatsapp, 1);

    const r2 = await sendCashbackNudges(tenantId, 5);
    assert.equal(r2.contacts, 0, "não reenvia (nudgedAt setado)");

    await prisma.cashbackEntry.deleteMany({ where: { tenantId } });
  });
});
