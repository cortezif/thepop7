import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { withTestTenant } from "./helpers.js";
import { createOrder, transitionOrder } from "../services/order-service.js";
import { cashbackBalance } from "../services/cashback-service.js";

// Cashback ponta a ponta via pedidos reais (ADR-031): acúmulo no pagamento +
// resgate automático no pedido seguinte. test:integration (precisa Postgres).

const prisma = getPrisma();

test("cashback: acumula no pagamento e resgata (auto, até o teto) no próximo pedido", async () => {
  await withTestTenant(async (tenantId) => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { cashbackEnabled: true, cashbackPct: 10, cashbackExpiryDays: 60, cashbackMaxRedeemPct: 50 } });
    const product = await prisma.product.create({
      data: { tenantId, externalId: "P1", name: "P", priceBRL: 100, variants: [{ sku: "P1-U", stock: 100 }] as any, media: {} as any, styles: [], occasions: [], enrichmentStatus: "approved", active: true },
    });
    const contact = await prisma.contact.create({ data: { tenantId, name: "Ana" } });

    // Pedido 1: R$200, sem saldo → nada a resgatar.
    const o1 = await createOrder({ tenantId, contactId: contact.id, items: [{ productId: product.id, variantSku: "P1-U", quantity: 2, unitPriceBRL: 100 }], shippingZip: "01310100", shippingBRL: 0 });
    assert.equal((o1 as any).cashbackRedeemedBRL, 0);
    // reserva p/ a baixa de estoque na confirmação de pagamento
    await prisma.stockReservation.create({ data: { tenantId, productId: product.id, contactId: contact.id, variantSku: "P1-U", quantity: 2, status: "active", expiresAt: new Date(Date.now() + 9e5) } });
    await transitionOrder(tenantId, o1.orderId, "paid");
    assert.equal(await cashbackBalance(tenantId, contact.id), 20, "10% de R$200 = R$20");

    // Pedido 2: R$60 → resgate auto: teto 50% = R$30, saldo R$20 → resgata R$20.
    const o2 = await createOrder({ tenantId, contactId: contact.id, items: [{ productId: product.id, variantSku: "P1-U", quantity: 1, unitPriceBRL: 60 }], shippingZip: "01310100", shippingBRL: 0 });
    assert.equal((o2 as any).cashbackRedeemedBRL, 20, "resgata os R$20 (abaixo do teto R$30)");
    assert.equal(o2.totalBRL, 40, "60 − 20 de cashback");
    assert.equal(await cashbackBalance(tenantId, contact.id), 0, "saldo zerado após resgate");

    // Limpeza do cashback (não coberto pelo helper genérico).
    await prisma.cashbackEntry.deleteMany({ where: { tenantId } });
  });
});
