import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getCacheStatsLive, clearCache } from "@hubadvisor/agent";
import { getPrisma, withTenant } from "@hubadvisor/db";
import { findDuplicateContacts, mergeContactsByIds } from "../services/identity-service.js";
import { SEGMENT_PRESETS, getSegmentPreset } from "../services/segment-presets.js";

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
      orderRetentionDays: tenant.orderRetentionDays,
      segment: tenant.segment,
      catalogVocab: tenant.catalogVocab ?? null,
    };
  });

  // GET /admin/segment-presets — tipos de negócio disponíveis (ADR-029)
  app.get("/segment-presets", async () => SEGMENT_PRESETS);

  // POST /admin/segment-config — segmento da loja + vocabulário + (opcional) voz da IA (ADR-029)
  app.post("/segment-config", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      segment: z.string().min(2).max(40),
      styles: z.array(z.string()).optional(),
      occasions: z.array(z.string()).optional(),
      applyVoice: z.boolean().optional(), // setar agentTone = voz da IA do preset
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    const segment = body.data.segment.toLowerCase();
    const styles = (body.data.styles ?? []).map((s) => s.trim()).filter(Boolean);
    const occasions = (body.data.occasions ?? []).map((s) => s.trim()).filter(Boolean);
    const catalogVocab = styles.length || occasions.length ? { styles, occasions } : null;

    const preset = getSegmentPreset(segment);
    const data: Record<string, unknown> = { segment, catalogVocab: catalogVocab as any };
    let voiceApplied = false;
    if (body.data.applyVoice && preset) { data.agentTone = preset.aiVoice; voiceApplied = true; }

    await withTenant(tenant.id, async (tx) => {
      await tx.tenant.update({ where: { id: tenant.id }, data });
      await tx.domainEvent.create({
        data: { tenantId: tenant.id, type: "segment.configured", aggregateType: "tenant", aggregateId: tenant.id, payload: { segment, catalogVocab, voiceApplied } as any, actor: "operator" },
      });
    });
    return { ok: true, segment, catalogVocab, voiceApplied };
  });

  // POST /admin/retention-config — política de retenção diferenciada (ADR-013). null = desativa.
  app.post("/retention-config", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      retentionDays: z.number().int().min(1).nullable().optional(),
      orderRetentionDays: z.number().int().min(1).nullable().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    const data: Record<string, number | null> = {};
    if ("retentionDays" in body.data) data.retentionDays = body.data.retentionDays ?? null;
    if ("orderRetentionDays" in body.data) data.orderRetentionDays = body.data.orderRetentionDays ?? null;
    await withTenant(tenant.id, async (tx) => {
      await tx.tenant.update({ where: { id: tenant.id }, data });
      await tx.domainEvent.create({
        data: { tenantId: tenant.id, type: "retention.configured", aggregateType: "tenant", aggregateId: tenant.id, payload: data as any, actor: "operator" },
      });
    });
    return { ok: true, ...data };
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
