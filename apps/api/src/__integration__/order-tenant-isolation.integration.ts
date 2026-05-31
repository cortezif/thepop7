import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { approveOrder, transitionOrder, cancelOrder, listOrders, exportOrdersCSV } from "../services/order-service.js";
import { eraseContact, exportContactData } from "../services/lgpd-service.js";

// Isolamento cross-tenant de pedidos/LGPD (ADR-037). RLS é bypassada (superuser),
// então a loja A NUNCA pode aprovar/transicionar/cancelar pedido nem apagar/exportar
// contato da loja B só passando o id. test:integration (Postgres).

const prisma = getPrisma();
const sfx = Date.now();

async function mkTenant(slug: string) {
  return prisma.tenant.create({ data: { slug, name: slug, status: "active", agentPersona: "Maya" } });
}

test("pedido/contato da loja B são intocáveis pela loja A", async () => {
  const A = await mkTenant(`itest-otA-${sfx}`);
  const B = await mkTenant(`itest-otB-${sfx}`);
  try {
    const contactB = await prisma.contact.create({ data: { tenantId: B.id, name: "CliB", phone: null } });
    const orderB = await prisma.order.create({
      data: { tenantId: B.id, contactId: contactB.id, status: "created", subtotalBRL: 100, totalBRL: 100, metadata: { pendingApproval: true } as any },
    });

    // A tenta aprovar o pedido da B → não encontra (não vaza, não muta).
    const appr = await approveOrder(A.id, orderB.id);
    assert.equal(appr.ok, false);
    assert.match(appr.reason ?? "", /não encontrado/);

    // A tenta transicionar/cancelar o pedido da B → erro "não encontrado".
    await assert.rejects(() => transitionOrder(A.id, orderB.id, "paid"), /não encontrado/);
    await assert.rejects(() => cancelOrder(A.id, orderB.id, "x"), /não encontrado/);

    // Pedido da B intacto (status não mudou).
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: orderB.id } })).status, "created");

    // A tenta apagar (LGPD) o contato da B → false; contato intacto (nome preservado).
    assert.equal(await eraseContact(A.id, contactB.id), false);
    assert.equal((await prisma.contact.findUniqueOrThrow({ where: { id: contactB.id } })).name, "CliB");

    // A tenta exportar dados do contato da B → null (não vaza PII).
    assert.equal(await exportContactData(A.id, contactB.id), null);

    // A LISTAGEM da loja A não enxerga o pedido da B (findMany sem where vazava
    // os 30 mais recentes de todos os tenants — corrigido com where: { tenantId }).
    const listA = await listOrders(A.id);
    assert.equal(listA.some((o) => o.id === orderB.id), false, "listOrders vazou pedido de outra loja");

    // O CSV contábil da loja A também não inclui o pedido da B.
    const csvA = await exportOrdersCSV(A.id);
    assert.equal(csvA.includes(orderB.id), false, "exportOrdersCSV vazou pedido de outra loja");

    // A dona (B) aprova o próprio pedido normalmente.
    const ok = await approveOrder(B.id, orderB.id);
    assert.equal(ok.ok, true);

    // E a B vê o próprio pedido na listagem.
    const listB = await listOrders(B.id);
    assert.equal(listB.some((o) => o.id === orderB.id), true);
  } finally {
    await prisma.tenant.deleteMany({ where: { slug: { in: [A.slug, B.slug] } } }).catch(() => {});
  }
});
