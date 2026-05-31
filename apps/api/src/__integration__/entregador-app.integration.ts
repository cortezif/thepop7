import { test, before, after } from "node:test";
import assert from "node:assert/strict";
process.env.USE_MOCK_CONNECTORS = "true";
import { getPrisma } from "@hubadvisor/db";
import { buildApp } from "../app.js";
import { withTestTenant } from "./helpers.js";
import { createCourier, createJobForOrder } from "../services/courier-service.js";

// App do entregador via ROTA HTTP pública (ADR-033): /entregador/:token.
// Exercita a camada de rota (inject), não só o service. test:integration.

const prisma = getPrisma();
const app = buildApp();
before(async () => { await app.ready(); });
after(async () => { await app.close(); });

test("rota /entregador/:token: vê corridas e avança até entregue", async () => {
  await withTestTenant(async (tenantId) => {
    const contact = await prisma.contact.create({ data: { tenantId, name: "Cli" } });
    const order = await prisma.order.create({ data: { tenantId, contactId: contact.id, status: "paid", subtotalBRL: 40, totalBRL: 40, shippingZip: "58000000" } });
    const courier = await createCourier(tenantId, { name: "João", vehicle: "moto" });
    const job = await createJobForOrder(tenantId, order.id, { courierId: courier.id, feeBRL: 7 });

    // GET — lista a corrida atribuída.
    const list = await app.inject({ method: "GET", url: `/entregador/${courier.accessToken}` });
    assert.equal(list.statusCode, 200);
    const body = list.json();
    assert.equal(body.courier.name, "João");
    assert.equal(body.jobs.length, 1);
    assert.equal(body.jobs[0].id, job.id);

    // Avança: aceitar → coletar → entregar.
    for (const action of ["aceitar", "coletar", "entregar"]) {
      const r = await app.inject({ method: "POST", url: `/entregador/${courier.accessToken}/jobs/${job.id}/${action}` });
      assert.equal(r.statusCode, 200, `ação ${action} ok`);
    }

    // Entregue fecha o pedido e some da lista.
    const ord = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
    assert.equal(ord.status, "delivered");
    const after2 = await app.inject({ method: "GET", url: `/entregador/${courier.accessToken}` });
    assert.equal(after2.json().jobs.length, 0);

    await prisma.financialEntry.deleteMany({ where: { tenantId } });
  });
});

test("rota /entregador: token inválido → 404; ação inválida → 400", async () => {
  const bad = await app.inject({ method: "GET", url: `/entregador/token-inexistente` });
  assert.equal(bad.statusCode, 404);

  await withTestTenant(async (tenantId) => {
    const contact = await prisma.contact.create({ data: { tenantId, name: "Cli" } });
    const order = await prisma.order.create({ data: { tenantId, contactId: contact.id, status: "paid", subtotalBRL: 10, totalBRL: 10 } });
    const courier = await createCourier(tenantId, { name: "Bia" });
    const job = await createJobForOrder(tenantId, order.id, { courierId: courier.id });

    const r = await app.inject({ method: "POST", url: `/entregador/${courier.accessToken}/jobs/${job.id}/voar` });
    assert.equal(r.statusCode, 400);
  });
});
