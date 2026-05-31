import { test, before, after } from "node:test";
import assert from "node:assert/strict";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "itest-secret";
import { getPrisma } from "@hubadvisor/db";
import { buildApp } from "../app.js";

// Isolamento do inbox por tenant (ADR-037) — a loja NÃO pode ver/operar conversas
// e notas de outra loja, mesmo com RLS bypassada (superuser). test:integration.

const prisma = getPrisma();
const app = buildApp();
const sfx = Date.now();
const slugA = `itest-inboxa-${sfx}`;
const slugB = `itest-inboxb-${sfx}`;

before(async () => { await app.ready(); });
after(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } }).catch(() => {});
  await app.close();
  await prisma.$disconnect();
});

async function signup(slug: string) {
  const r = await app.inject({ method: "POST", url: "/auth/signup", payload: { storeName: slug, slug, name: "Op", email: `op@${slug}.com`, password: "senha123" } });
  return r.json().token as string;
}

test("inbox: loja A não vê nem apaga conversa/nota da loja B", async () => {
  const tokenA = await signup(slugA);
  const tokenB = await signup(slugB);
  const tenantB = await prisma.tenant.findUniqueOrThrow({ where: { slug: slugB } });

  // Conversa + nota da loja B.
  const contactB = await prisma.contact.create({ data: { tenantId: tenantB.id, name: "Cliente B" } });
  const convB = await prisma.conversation.create({ data: { tenantId: tenantB.id, contactId: contactB.id, channel: "whatsapp" } });
  const noteB = await prisma.conversationNote.create({ data: { conversationId: convB.id, text: "segredo da loja B" } });

  // Loja A lista conversas → NÃO inclui a conversa da B.
  const listA = await app.inject({ method: "GET", url: `/inbox/conversations?tenantSlug=${slugA}`, headers: { authorization: `Bearer ${tokenA}` } });
  assert.equal(listA.statusCode, 200);
  assert.ok(!listA.json().some((c: any) => c.id === convB.id), "A não vê a conversa da B");

  // Loja A tenta ler as notas da conversa da B → vazio (não vaza).
  const notesA = await app.inject({ method: "GET", url: `/inbox/conversations/${convB.id}/notes?tenantSlug=${slugA}`, headers: { authorization: `Bearer ${tokenA}` } });
  assert.equal(notesA.json().length, 0, "A não lê notas da B");

  // Loja A tenta apagar a nota da B → 404 e a nota CONTINUA existindo.
  const delA = await app.inject({ method: "DELETE", url: `/inbox/conversations/${convB.id}/notes/${noteB.id}?tenantSlug=${slugA}`, headers: { authorization: `Bearer ${tokenA}` } });
  assert.equal(delA.statusCode, 404, "A não apaga nota da B");
  assert.ok(await prisma.conversationNote.findUnique({ where: { id: noteB.id } }), "nota da B intacta");

  // Loja B (dona) vê a conversa, lê e APAGA a própria nota.
  const listB = await app.inject({ method: "GET", url: `/inbox/conversations?tenantSlug=${slugB}`, headers: { authorization: `Bearer ${tokenB}` } });
  assert.ok(listB.json().some((c: any) => c.id === convB.id), "B vê a própria conversa");
  const delB = await app.inject({ method: "DELETE", url: `/inbox/conversations/${convB.id}/notes/${noteB.id}?tenantSlug=${slugB}`, headers: { authorization: `Bearer ${tokenB}` } });
  assert.equal(delB.statusCode, 200);
  assert.deepEqual(delB.json(), { ok: true });
  assert.equal(await prisma.conversationNote.findUnique({ where: { id: noteB.id } }), null, "nota apagada pela dona");
});
