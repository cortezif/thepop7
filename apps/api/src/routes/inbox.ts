import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPrisma, withTenant, decryptPII, resolveTenantCredentials } from "@hubadvisor/db";
import { getMessagingConnector } from "@hubadvisor/connectors";
import { enterCredentials } from "@hubadvisor/shared";
import { suggestReply, summarizeAndPersist } from "../services/conversation-service.js";

async function resolveTenant(slug: string) {
  const tenant = await getPrisma().tenant.findUnique({ where: { slug } });
  return tenant;
}

export const inboxRoutes: FastifyPluginAsync = async (app) => {
  // GET /inbox/conversations?tenantSlug=...&status=active|handed_off|closed
  app.get("/conversations", async (req, reply) => {
    const q = req.query as any;
    const tenant = await resolveTenant(q.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });

    return withTenant(tenant.id, async (tx) => {
      const convs = await tx.conversation.findMany({
        where: q.status ? { status: q.status } : {},
        orderBy: { lastMessageAt: "desc" },
        take: 50,
        include: {
          contact: { select: { name: true, phone: true, igHandle: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, direction: true, createdAt: true } },
        },
      });
      return convs.map((c) => ({
        id: c.id,
        channel: c.channel,
        status: c.status,
        contactName: c.contact?.name ?? decryptPII(c.contact?.phone) ?? c.contact?.igHandle ?? "Anônima",
        lastMessage: c.messages[0]?.content ?? "",
        lastMessageAt: c.lastMessageAt,
        handoffReason: c.handoffReason,
        summary: c.summary,
        tags: c.tags,
        assignedToId: c.assignedToId,
        assignedToName: c.assignedToName,
      }));
    });
  });

  // GET /inbox/conversations/:id/messages?tenantSlug=...
  app.get("/conversations/:id/messages", async (req, reply) => {
    const id = (req.params as any).id;
    const tenant = await resolveTenant((req.query as any).tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });

    return withTenant(tenant.id, async (tx) => {
      const messages = await tx.message.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true, direction: true, type: true, content: true,
          llmModel: true, llmCostBRL: true, toolCalls: true, createdAt: true,
          reviewFlagged: true, reviewReasons: true,
        },
      });
      return messages;
    });
  });

  // POST /inbox/conversations/:id/reply — atendente humano responde
  app.post("/conversations/:id/reply", async (req, reply) => {
    const id = (req.params as any).id;
    const body = z.object({
      tenantSlug: z.string(),
      text: z.string().min(1),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    enterCredentials(await resolveTenantCredentials(tenant.id));

    return withTenant(tenant.id, async (tx) => {
      const conv = await tx.conversation.findUnique({ where: { id } });
      if (!conv) throw new Error("conversa não encontrada");

      const msg = await tx.message.create({
        data: { conversationId: id, direction: "out", type: "text", content: body.data.text },
      });
      await tx.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), status: "handed_off" },
      });

      // Envia no canal real (mock em dev)
      await getMessagingConnector().send({
        tenantId: tenant.id,
        conversationId: id,
        type: "text",
        text: body.data.text,
      });

      return { ok: true, messageId: msg.id };
    });
  });

  // POST /inbox/conversations/:id/tags — define as tags da conversa (ADR-016)
  app.post("/conversations/:id/tags", async (req, reply) => {
    const id = (req.params as any).id;
    const body = z.object({ tenantSlug: z.string(), tags: z.array(z.string().min(1).max(30)).max(12) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    const tags = [...new Set(body.data.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    return withTenant(tenant.id, async (tx) => {
      await tx.conversation.update({ where: { id }, data: { tags } });
      return { ok: true, tags };
    });
  });

  // GET /inbox/conversations/:id/notes — notas internas
  app.get("/conversations/:id/notes", async (req, reply) => {
    const id = (req.params as any).id;
    const tenant = await resolveTenant((req.query as any).tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return withTenant(tenant.id, async (tx) =>
      tx.conversationNote.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } })
    );
  });

  // POST /inbox/conversations/:id/notes — adiciona nota interna (autor = operador logado)
  app.post("/conversations/:id/notes", async (req, reply) => {
    const id = (req.params as any).id;
    const body = z.object({ tenantSlug: z.string(), text: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return withTenant(tenant.id, async (tx) =>
      tx.conversationNote.create({ data: { conversationId: id, text: body.data.text, authorId: req.auth?.sub, authorName: req.auth?.email } })
    );
  });

  // POST /inbox/conversations/:id/assign — atribui ao operador logado (ou desatribui)
  app.post("/conversations/:id/assign", async (req, reply) => {
    const id = (req.params as any).id;
    const body = z.object({ tenantSlug: z.string(), unassign: z.boolean().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    const data = body.data.unassign
      ? { assignedToId: null, assignedToName: null }
      : { assignedToId: req.auth?.sub ?? null, assignedToName: req.auth?.email ?? null };
    return withTenant(tenant.id, async (tx) => {
      await tx.conversation.update({ where: { id }, data });
      return { ok: true, assignedToName: data.assignedToName };
    });
  });

  // POST /inbox/conversations/:id/suggest — co-piloto: Maya sugere resposta (read-only)
  app.post("/conversations/:id/suggest", async (req, reply) => {
    const id = (req.params as any).id;
    const body = z.object({ tenantSlug: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });

    try {
      return await suggestReply(body.data.tenantSlug, id, req.log);
    } catch (e: any) {
      // IA indisponível (limite/saldo/outage de TODOS os provedores) → não 500.
      req.log.error(e, "suggest falhou (IA indisponível)");
      return reply.code(200).send({
        suggestion: "",
        aiUnavailable: true,
        note: "IA temporariamente indisponível (limite/saldo dos provedores). Responda manualmente ou tente em instantes.",
      });
    }
  });

  // POST /inbox/conversations/:id/status — muda status (assumir/encerrar/reabrir)
  app.post("/conversations/:id/status", async (req, reply) => {
    const id = (req.params as any).id;
    const body = z.object({
      tenantSlug: z.string(),
      status: z.enum(["active", "handed_off", "closed"]),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });

    await withTenant(tenant.id, async (tx) => {
      await tx.conversation.update({ where: { id }, data: { status: body.data.status } });
    });

    // Ao encerrar, gera o resumo pra virar memória da cliente (ADR-007).
    if (body.data.status === "closed") {
      try {
        const { summary } = await summarizeAndPersist(body.data.tenantSlug, id, req.log);
        return { ok: true, summary };
      } catch (e) {
        req.log.error({ err: e }, "falha ao resumir conversa ao fechar");
        return { ok: true, summaryError: true };
      }
    }
    return { ok: true };
  });

  // POST /inbox/conversations/:id/summarize — gera/atualiza o resumo sob demanda
  app.post("/conversations/:id/summarize", async (req, reply) => {
    const id = (req.params as any).id;
    const body = z.object({ tenantSlug: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return summarizeAndPersist(body.data.tenantSlug, id, req.log);
  });
};
