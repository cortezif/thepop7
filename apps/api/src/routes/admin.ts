import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getCacheStatsLive, clearCache } from "@thepop/agent";
import { getPrisma, withTenant } from "@thepop/db";
import { findDuplicateContacts, mergeContactsByIds } from "../services/identity-service.js";

async function resolveTenant(slug: string) {
  return getPrisma().tenant.findUnique({ where: { slug } });
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // GET /admin/cache/stats
  app.get("/cache/stats", async () => {
    return getCacheStatsLive();
  });

  // POST /admin/cache/clear
  app.post("/cache/clear", async () => {
    clearCache();
    return { ok: true, cleared: true };
  });

  // GET /admin/config?tenantSlug=... — estado de automação do tenant
  app.get("/config", async (req, reply) => {
    const tenant = await resolveTenant((req.query as any).tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return {
      aiEnabled: tenant.aiEnabled,
      monthlyAIBudgetBRL: Number(tenant.monthlyAIBudgetBRL),
      autoApproveMaxBRL: Number(tenant.autoApproveMaxBRL),
      retentionDays: tenant.retentionDays,
    };
  });

  // POST /admin/retention-config — define a política de retenção (ADR-013). null = desativa.
  app.post("/retention-config", async (req, reply) => {
    const body = z.object({ tenantSlug: z.string(), retentionDays: z.number().int().min(1).nullable() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    await withTenant(tenant.id, async (tx) => {
      await tx.tenant.update({ where: { id: tenant.id }, data: { retentionDays: body.data.retentionDays } });
      await tx.domainEvent.create({
        data: { tenantId: tenant.id, type: "retention.configured", aggregateType: "tenant", aggregateId: tenant.id, payload: { retentionDays: body.data.retentionDays } as any, actor: "operator" },
      });
    });
    return { ok: true, retentionDays: body.data.retentionDays };
  });

  // POST /admin/auto-approve — ajusta o teto de auto-aprovação (ADR-025)
  app.post("/auto-approve", async (req, reply) => {
    const body = z.object({ tenantSlug: z.string(), maxBRL: z.number().min(0) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });

    await withTenant(tenant.id, async (tx) => {
      await tx.tenant.update({ where: { id: tenant.id }, data: { autoApproveMaxBRL: body.data.maxBRL } });
      await tx.domainEvent.create({
        data: {
          tenantId: tenant.id, type: "auto_approve.changed", aggregateType: "tenant", aggregateId: tenant.id,
          payload: { maxBRL: body.data.maxBRL } as any, actor: "operator",
        },
      });
    });
    return { ok: true, autoApproveMaxBRL: body.data.maxBRL };
  });

  // POST /admin/ai-toggle — liga/desliga o kill-switch (ADR-025), com evento de auditoria
  app.post("/ai-toggle", async (req, reply) => {
    const body = z.object({ tenantSlug: z.string(), enabled: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });

    await withTenant(tenant.id, async (tx) => {
      await tx.tenant.update({ where: { id: tenant.id }, data: { aiEnabled: body.data.enabled } });
      await tx.domainEvent.create({
        data: {
          tenantId: tenant.id,
          type: body.data.enabled ? "ai.enabled" : "ai.disabled",
          aggregateType: "tenant",
          aggregateId: tenant.id,
          payload: { enabled: body.data.enabled } as any,
          actor: "operator",
        },
      });
    });
    req.log.warn({ tenantSlug: body.data.tenantSlug, enabled: body.data.enabled }, "kill-switch alterado");
    return { ok: true, aiEnabled: body.data.enabled };
  });

  // GET /admin/identity/duplicates?tenantSlug=... — candidatos a merge (ADR-015)
  app.get("/identity/duplicates", async (req, reply) => {
    const tenant = await resolveTenant((req.query as any).tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return findDuplicateContacts(tenant.id);
  });

  // POST /admin/identity/merge — funde dois contatos
  app.post("/identity/merge", async (req, reply) => {
    const body = z.object({ tenantSlug: z.string(), idA: z.string(), idB: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return mergeContactsByIds(body.data.tenantSlug, body.data.idA, body.data.idB, req.log);
  });
};
