import { test } from "node:test";
import assert from "node:assert/strict";
process.env.USE_MOCK_CONNECTORS = "true";
import { getPrisma, encryptPII } from "@hubadvisor/db";
import { withTestTenant } from "./helpers.js";
import { sendWinbackAuto } from "../services/broadcast-service.js";

// Recompra automática (ADR-031): pega compradores inativos há N dias, respeita
// opt-out e o throttle de 30 dias (lastWinbackAt). test:integration (Postgres).

const prisma = getPrisma();

test("winback auto: reativa inativo, respeita opt-out e throttle de 30d", async () => {
  await withTestTenant(async (tenantId) => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { winbackInactiveDays: 60 } });
    const old = new Date(Date.now() - 90 * 86_400_000);

    // Ana: inativa há 90d, sem winback → reativa
    const ana = await prisma.contact.create({ data: { tenantId, name: "Ana", phone: encryptPII("5583999990001") } });
    await prisma.order.create({ data: { tenantId, contactId: ana.id, status: "paid", subtotalBRL: 100, totalBRL: 100, createdAt: old } });
    // Bia: inativa há 90d MAS já recebeu winback há 10d → throttle barra
    const bia = await prisma.contact.create({ data: { tenantId, name: "Bia", phone: encryptPII("5583999990002"), lastWinbackAt: new Date(Date.now() - 10 * 86_400_000) } });
    await prisma.order.create({ data: { tenantId, contactId: bia.id, status: "paid", subtotalBRL: 50, totalBRL: 50, createdAt: old } });
    // Cao: inativa há 90d MAS opt-out recompra → excluída
    const cao = await prisma.contact.create({ data: { tenantId, name: "Cao", phone: encryptPII("5583999990003"), optOuts: ["recompra"] } });
    await prisma.order.create({ data: { tenantId, contactId: cao.id, status: "paid", subtotalBRL: 70, totalBRL: 70, createdAt: old } });

    const r1 = await sendWinbackAuto(tenantId);
    assert.equal(r1.contacts, 1, "só Ana (Bia throttle, Cao opt-out)");
    assert.equal(r1.sentWhatsapp, 1);

    // lastWinbackAt marcado → segunda passada não reenvia
    const r2 = await sendWinbackAuto(tenantId);
    assert.equal(r2.contacts, 0, "Ana agora dentro do throttle");
  });
});
