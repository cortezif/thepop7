import { test } from "node:test";
import assert from "node:assert/strict";
process.env.USE_MOCK_CONNECTORS = "true"; // notificação WhatsApp via mock
import { getPrisma } from "@hubadvisor/db";
import { withTestTenant } from "./helpers.js";
import {
  createCourier, listCouriers, createJobForOrder, assignJob,
  courierByToken, courierJobs, courierTransition, transitionJob,
} from "../services/courier-service.js";

// Entregadores próprios + corridas (ADR-033): cadastro, atribuição e ciclo até
// entregue pelo app do entregador (token). test:integration (Postgres).

const prisma = getPrisma();

test("entregadores: cadastra, atribui pedido e entrega pelo app do entregador", async () => {
  await withTestTenant(async (tenantId) => {
    const contact = await prisma.contact.create({ data: { tenantId, name: "Cli" } });
    const order = await prisma.order.create({ data: { tenantId, contactId: contact.id, status: "paid", subtotalBRL: 50, totalBRL: 50, shippingZip: "58000000" } });

    const courier = await createCourier(tenantId, { name: "João Moto", phone: "5583999990000", vehicle: "moto" });
    assert.ok(courier.accessToken, "tem token de acesso");
    assert.equal((await listCouriers(tenantId)).length, 1);

    const job = await createJobForOrder(tenantId, order.id, { feeBRL: 8 });
    assert.equal(job.status, "pendente");
    assert.equal(job.address, "58000000", "snapshot do CEP quando sem endereço");
    const assigned = await assignJob(tenantId, job.id, courier.id);
    assert.equal(assigned.status, "atribuido");
    assert.ok(assigned.assignedAt);

    await assert.rejects(() => createJobForOrder(tenantId, order.id, {}), /já tem uma corrida ativa/);

    const view = await courierByToken(courier.accessToken);
    assert.equal(view?.id, courier.id);
    assert.equal((await courierJobs(courier.id)).length, 1);

    await courierTransition(courier.accessToken, job.id, "aceito");
    await courierTransition(courier.accessToken, job.id, "coletado");
    const done = await courierTransition(courier.accessToken, job.id, "entregue");
    assert.equal(done.status, "entregue");

    const ord = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, deliveredAt: true } });
    assert.equal(ord.status, "delivered", "entregue fecha o pedido");
    assert.ok(ord.deliveredAt);

    assert.equal((await courierJobs(courier.id)).length, 0, "entregue some da lista do entregador");

    // Fase 2: o pagamento do entregador virou despesa no Financeiro.
    const desp = await prisma.financialEntry.findFirst({ where: { tenantId, category: "entregador" } });
    assert.ok(desp, "lançou despesa do entregador");
    assert.equal(Number(desp!.amountBRL), 8);
    assert.equal(desp!.type, "despesa");
    assert.equal(desp!.description, "João Moto");

    await prisma.financialEntry.deleteMany({ where: { tenantId } });
  });
});

test("entregadores: transição inválida e token errado são rejeitados", async () => {
  await withTestTenant(async (tenantId) => {
    const contact = await prisma.contact.create({ data: { tenantId, name: "Cli" } });
    const order = await prisma.order.create({ data: { tenantId, contactId: contact.id, status: "paid", subtotalBRL: 20, totalBRL: 20 } });
    const courier = await createCourier(tenantId, { name: "Bia", vehicle: "bike" });
    const job = await createJobForOrder(tenantId, order.id, { courierId: courier.id });
    assert.equal(job.status, "atribuido", "criada já atribuída quando passa courierId");

    await assert.rejects(() => transitionJob(tenantId, job.id, "entregue"), /inválida/);
    await assert.rejects(() => courierTransition("token-falso", job.id, "aceito"), /acesso inválido/);
  });
});
