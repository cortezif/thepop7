import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { withTestTenant } from "./helpers.js";
import { applyCourierWebhook } from "../services/courier-dispatch-service.js";

// Rastreio de entregador on-demand (ADR-030): webhook de status → atualiza o
// pedido. Network-free (não passa por geocoding/dispatch). Roda em test:integration.

const prisma = getPrisma();

async function orderWithCourier(tenantId: string, deliveryId: string) {
  const contact = await prisma.contact.create({ data: { tenantId, name: "Ana" } });
  return prisma.order.create({
    data: {
      tenantId, contactId: contact.id, status: "paid", shippingZip: "01310100",
      subtotalBRL: 100, shippingBRL: 14, totalBRL: 114,
      trackingCode: deliveryId,
      carrier: "Entregador moto (mock)",
      metadata: { courier: { provider: "mock", deliveryId, status: "assigned" } } as any,
    },
  });
}

test("webhook do courier atualiza status; COMPLETED marca deliveredAt", async () => {
  await withTestTenant(async (tenantId) => {
    const order = await orderWithCourier(tenantId, "deliv-123");

    // PICKED_UP → picked_up, sem deliveredAt
    let r = await applyCourierWebhook({ data: { order: { orderId: "deliv-123", status: "PICKED_UP" } } });
    assert.equal(r.ok, true);
    assert.equal((r as any).status, "picked_up");
    let o = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal((o!.metadata as any).courier.status, "picked_up");
    assert.equal(o!.deliveredAt, null);

    // COMPLETED → delivered + deliveredAt
    r = await applyCourierWebhook({ data: { order: { orderId: "deliv-123", status: "COMPLETED" } } });
    assert.equal((r as any).status, "delivered");
    o = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal((o!.metadata as any).courier.status, "delivered");
    assert.ok(o!.deliveredAt, "COMPLETED marca deliveredAt");

    // evento de domínio registrado
    const evt = await prisma.domainEvent.findFirst({ where: { tenantId, type: "courier.delivered", aggregateId: order.id } });
    assert.ok(evt, "evento courier.delivered gravado");
  });
});

test("webhook com deliveryId desconhecido → ok:false (não derruba)", async () => {
  await withTestTenant(async () => {
    const r = await applyCourierWebhook({ data: { order: { orderId: "inexistente-999", status: "PICKED_UP" } } });
    assert.equal(r.ok, false);
    assert.match((r as any).reason, /não encontrado/);
  });
});

test("webhook sem deliveryId → ok:false", async () => {
  await withTestTenant(async () => {
    const r = await applyCourierWebhook({ data: { order: { status: "PICKED_UP" } } });
    assert.equal(r.ok, false);
  });
});
