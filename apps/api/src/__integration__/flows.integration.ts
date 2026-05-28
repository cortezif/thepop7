import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrisma, withTenant } from "@thepop/db";
import { withTestTenant } from "./helpers.js";
import { transitionOrder } from "../services/order-service.js";
import { resolveContact } from "../services/identity-service.js";
import { runRetention } from "../services/lgpd-service.js";

const prisma = getPrisma();

test("baixa de estoque na confirmação de pagamento (ADR-009/011)", async () => {
  await withTestTenant(async (tenantId) => {
    const product = await prisma.product.create({
      data: {
        tenantId, externalId: "IT-001", name: "Item Teste", priceBRL: 100, costBRL: 40,
        variants: [{ sku: "IT-001-M", color: "Azul", size: "M", stock: 5 }],
        media: {}, styles: [], occasions: [], enrichmentStatus: "approved", active: true,
      },
    });
    const contact = await prisma.contact.create({ data: { tenantId, name: "Cliente Teste" } });
    const order = await prisma.order.create({
      data: {
        tenantId, contactId: contact.id, status: "created",
        subtotalBRL: 100, shippingBRL: 0, totalBRL: 100,
        items: { create: [{ productId: product.id, variantSku: "IT-001-M", quantity: 2, unitPriceBRL: 100 }] },
      },
    });
    await prisma.stockReservation.create({
      data: { tenantId, productId: product.id, contactId: contact.id, variantSku: "IT-001-M", quantity: 2, status: "active", expiresAt: new Date(Date.now() + 9e5) },
    });

    await transitionOrder(tenantId, order.id, "paid");

    const after = await prisma.product.findUnique({ where: { id: product.id } });
    const variants = after!.variants as Array<{ sku: string; stock: number }>;
    assert.equal(variants.find((v) => v.sku === "IT-001-M")!.stock, 3, "5 − 2 = 3");

    const res = await prisma.stockReservation.findFirst({ where: { tenantId, variantSku: "IT-001-M" } });
    assert.equal(res!.status, "converted", "reserva vira converted no pagamento");
  });
});

test("merge cross-canal por convergência (ADR-015)", async () => {
  await withTestTenant(async (tenantId) => {
    // Mensagem 1: só Instagram → cria A. Mensagem 2: só telefone → cria B.
    await withTenant(tenantId, (tx) => resolveContact(tx, tenantId, { igHandle: "@itest", name: "IG" }));
    await withTenant(tenantId, (tx) => resolveContact(tx, tenantId, { phone: "+5511900000000", name: "Zap" }));
    let count = await prisma.contact.count({ where: { tenantId } });
    assert.equal(count, 2, "dois contatos distintos antes da convergência");

    // Mensagem 3: ambos os identificadores → funde A e B num só.
    await withTenant(tenantId, (tx) => resolveContact(tx, tenantId, { igHandle: "@itest", phone: "+5511900000000" }));
    count = await prisma.contact.count({ where: { tenantId } });
    assert.equal(count, 1, "convergência funde em um contato canônico");

    const merged = await prisma.domainEvent.count({ where: { tenantId, type: "contact.merged" } });
    assert.ok(merged >= 1, "evento de auditoria contact.merged registrado");
  });
});

test("retenção anonimiza conversa inativa além do prazo (ADR-013)", async () => {
  await withTestTenant(async (tenantId) => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { retentionDays: 30 } });
    const contact = await prisma.contact.create({ data: { tenantId, name: "Cliente" } });
    const oldDate = new Date(Date.now() - 60 * 864e5); // 60 dias atrás
    const conv = await prisma.conversation.create({
      data: { tenantId, contactId: contact.id, channel: "manual", status: "closed", startedAt: oldDate, lastMessageAt: oldDate },
    });
    await prisma.message.create({ data: { conversationId: conv.id, direction: "in", type: "text", content: "dado sensível antigo", createdAt: oldDate } });
    // Mensagem recente (não deve ser tocada)
    const recentConv = await prisma.conversation.create({ data: { tenantId, contactId: contact.id, channel: "manual" } });
    await prisma.message.create({ data: { conversationId: recentConv.id, direction: "in", type: "text", content: "mensagem recente" } });

    const r = await runRetention(tenantId);
    assert.equal(r.ok, true);

    const oldMsg = await prisma.message.findFirst({ where: { conversationId: conv.id } });
    assert.match(oldMsg!.content ?? "", /removido por pol/, "msg antiga anonimizada");
    const recentMsg = await prisma.message.findFirst({ where: { conversationId: recentConv.id } });
    assert.equal(recentMsg!.content, "mensagem recente", "msg recente intacta");
  });
});

test.after(async () => { await prisma.$disconnect(); });
