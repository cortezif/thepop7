import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrisma, withTenant } from "@hubadvisor/db";
import { withTestTenant } from "./helpers.js";
import { handleIncomingMessage } from "../services/conversation-service.js";
import { resolveContact } from "../services/identity-service.js";

// Perfil/classificação do cliente (ADR-036) — gates operacionais no inbound REAL,
// que retornam ANTES do agente (sem LLM). test:integration.

const prisma = getPrisma();
const log = { info() {}, warn() {}, error() {}, debug() {} } as any;

test("perfil banido: não atende; parqueia pra humano sem resposta", async () => {
  await withTestTenant(async (tenantId) => {
    const slug = (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } })).slug;
    const c = await withTenant(tenantId, (tx) => resolveContact(tx, tenantId, { phone: "+5583990000001", name: "X" }));
    await prisma.contact.update({ where: { id: c.id }, data: { tags: ["banido"] } });

    const r = await handleIncomingMessage({ tenantSlug: slug, channel: "whatsapp", contact: { phone: "+5583990000001" }, text: "oi" }, log);
    assert.equal((r as any).blocked, true);
    assert.equal(r.reply, null, "banido não recebe resposta automática");
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: r.conversationId }, select: { status: true, handoffReason: true } });
    assert.equal(conv.status, "handed_off");
    assert.match(conv.handoffReason ?? "", /banido/i);
  });
});

test("perfil atendimento humano: encaminha já, com aviso gentil", async () => {
  await withTestTenant(async (tenantId) => {
    const slug = (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } })).slug;
    const c = await withTenant(tenantId, (tx) => resolveContact(tx, tenantId, { phone: "+5583990000002", name: "Y" }));
    await prisma.contact.update({ where: { id: c.id }, data: { tags: ["atencao_humana"] } });

    const r = await handleIncomingMessage({ tenantSlug: slug, channel: "whatsapp", contact: { phone: "+5583990000002" }, text: "oi" }, log);
    assert.equal((r as any).handoff, true);
    assert.match(r.reply ?? "", /encaminhar para uma pessoa/i);
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: r.conversationId }, select: { status: true } });
    assert.equal(conv.status, "handed_off");
  });
});
