import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrisma, withTenant } from "@hubadvisor/db";
import { withTestTenant } from "./helpers.js";
import { handleIncomingMessage } from "../services/conversation-service.js";
import { resolveContact } from "../services/identity-service.js";

// E2E do NPS pós-venda no caminho REAL do inbound (ADR-017). O fluxo de detrator
// retorna ANTES do agente (sem LLM), então roda em test:integration sem Anthropic.

const prisma = getPrisma();
const log = { info() {}, warn() {}, error() {}, debug() {} } as any;
const PHONE = "+5583999990002";

test("inbound NPS: detrator escala pra humano e a próxima msg vira o comentário", async () => {
  await withTestTenant(async (tenantId) => {
    const slug = (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } })).slug;

    // Cria o contato pelo MESMO telefone que o inbound vai resolver (por hash).
    const contact = await withTenant(tenantId, (tx) => resolveContact(tx, tenantId, { phone: PHONE, name: "Bia" }));
    // Pedido entregue + marco D+14 (pré-condição da captura de NPS).
    const order = await prisma.order.create({ data: { tenantId, contactId: contact.id, status: "delivered", subtotalBRL: 100, totalBRL: 100 } });
    await prisma.domainEvent.create({ data: { tenantId, type: "postsale.d14", aggregateType: "order", aggregateId: order.id, payload: { stage: "d14" } as any, actor: "agent" } });

    // 1) Nota 3 → detrator: registra, responde pedindo o motivo, escala pra humano. (sem LLM)
    const r1 = await handleIncomingMessage({ tenantSlug: slug, channel: "whatsapp", contact: { phone: PHONE }, text: "3" }, log);
    assert.equal(r1.npsCaptured, 3);
    assert.equal(r1.handoff, true);
    assert.match(r1.reply ?? "", /o que poderia ter sido melhor/i);

    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: r1.conversationId }, select: { status: true, handoffReason: true } });
    assert.equal(conv.status, "handed_off", "detrator escalado");
    assert.match(conv.handoffReason ?? "", /detrator/i);

    const nps1 = await prisma.npsResponse.findFirstOrThrow({ where: { tenantId, contactId: contact.id } });
    assert.equal(nps1.score, 3);
    assert.equal(nps1.comment, null);

    // 2) Próxima mensagem (texto) → vira o comentário; também não aciona o agente.
    const r2 = await handleIncomingMessage({ tenantSlug: slug, channel: "whatsapp", contact: { phone: PHONE }, text: "Demorou demais pra entregar" }, log);
    assert.match(r2.reply ?? "", /equipe/i);
    const nps2 = await prisma.npsResponse.findUniqueOrThrow({ where: { id: nps1.id } });
    assert.match(nps2.comment ?? "", /Demorou/);

    await prisma.npsResponse.deleteMany({ where: { tenantId } });
  });
});

test("inbound NPS: promotor agradece e NÃO escala", async () => {
  await withTestTenant(async (tenantId) => {
    const slug = (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } })).slug;
    const contact = await withTenant(tenantId, (tx) => resolveContact(tx, tenantId, { phone: PHONE, name: "Ana" }));
    const order = await prisma.order.create({ data: { tenantId, contactId: contact.id, status: "delivered", subtotalBRL: 80, totalBRL: 80 } });
    await prisma.domainEvent.create({ data: { tenantId, type: "postsale.d14", aggregateType: "order", aggregateId: order.id, payload: { stage: "d14" } as any, actor: "agent" } });

    const r = await handleIncomingMessage({ tenantSlug: slug, channel: "whatsapp", contact: { phone: PHONE }, text: "10" }, log);
    assert.equal(r.npsCaptured, 10);
    assert.notEqual(r.handoff, true);
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: r.conversationId }, select: { status: true } });
    assert.equal(conv.status, "active", "promotor não escala");

    await prisma.npsResponse.deleteMany({ where: { tenantId } });
  });
});
