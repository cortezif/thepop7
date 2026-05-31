import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getCacheStatsLive, clearCache } from "@hubadvisor/agent";
import { getPrisma, withTenant } from "@hubadvisor/db";
import { findDuplicateContacts, mergeContactsByIds } from "../services/identity-service.js";
import { SEGMENT_PRESETS, getSegmentPreset } from "../services/segment-presets.js";
import { requireRole } from "../auth.js";
import { storeMapsUrl } from "../lib/store-pickup.js";

// Mutações administrativas (configuração da loja) exigem owner/admin. Leituras
// (config, presets, stats) seguem disponíveis a qualquer operador autenticado.
const adminOnly = { preHandler: requireRole("owner", "admin") };

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
      productionEnabled: tenant.productionEnabled,
      storeZip: (tenant.policies as any)?.storeZip ?? null,
      storeAddress: (tenant.policies as any)?.storeAddress ?? null,
      storeMapsUrl: storeMapsUrl(tenant.policies as any),
      cashback: {
        enabled: tenant.cashbackEnabled,
        pct: tenant.cashbackPct,
        expiryDays: tenant.cashbackExpiryDays,
        maxRedeemPct: tenant.cashbackMaxRedeemPct,
      },
      winback: {
        enabled: tenant.winbackEnabled,
        inactiveDays: tenant.winbackInactiveDays,
      },
    };
  });

  // POST /admin/winback-config — recompra automática (ADR-031)
  app.post("/winback-config", adminOnly, async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      enabled: z.boolean().optional(),
      inactiveDays: z.number().int().min(1).max(3650).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    const data: Record<string, unknown> = {};
    if ("enabled" in body.data) data.winbackEnabled = body.data.enabled;
    if (body.data.inactiveDays != null) data.winbackInactiveDays = body.data.inactiveDays;
    await withTenant(tenant.id, async (tx) => {
      await tx.tenant.update({ where: { id: tenant.id }, data });
    });
    return { ok: true, ...data };
  });

  // POST /admin/cashback-config — regras de cashback (ADR-031)
  app.post("/cashback-config", adminOnly, async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      enabled: z.boolean().optional(),
      pct: z.number().min(0).max(100).optional(),
      expiryDays: z.number().int().min(1).max(3650).optional(),
      maxRedeemPct: z.number().min(0).max(100).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    const data: Record<string, unknown> = {};
    if ("enabled" in body.data) data.cashbackEnabled = body.data.enabled;
    if (body.data.pct != null) data.cashbackPct = body.data.pct;
    if (body.data.expiryDays != null) data.cashbackExpiryDays = body.data.expiryDays;
    if (body.data.maxRedeemPct != null) data.cashbackMaxRedeemPct = body.data.maxRedeemPct;
    await withTenant(tenant.id, async (tx) => {
      await tx.tenant.update({ where: { id: tenant.id }, data });
    });
    return { ok: true, ...data };
  });

  // POST /admin/store-config — CEP de origem da loja (entregas on-demand, ADR-030)
  // + endereço da loja para RETIRADA (ADR-034). Ambos opcionais.
  app.post("/store-config", adminOnly, async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      storeZip: z.string().nullable().optional(),
      storeAddress: z.string().nullable().optional(),
      storeMapsUrl: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    const policies = { ...((tenant.policies as Record<string, unknown>) ?? {}) };
    if (body.data.storeZip !== undefined) {
      const zip = (body.data.storeZip ?? "").replace(/\D/g, "").slice(0, 8) || null;
      if (zip) policies.storeZip = zip; else delete policies.storeZip;
    }
    if (body.data.storeAddress !== undefined) {
      const addr = (body.data.storeAddress ?? "").trim().slice(0, 300) || null;
      if (addr) policies.storeAddress = addr; else delete policies.storeAddress;
    }
    if (body.data.storeMapsUrl !== undefined) {
      const url = (body.data.storeMapsUrl ?? "").trim().slice(0, 500) || null;
      if (url) policies.storeMapsUrl = url; else delete policies.storeMapsUrl;
    }
    await withTenant(tenant.id, async (tx) => {
      await tx.tenant.update({ where: { id: tenant.id }, data: { policies: policies as any } });
    });
    return {
      ok: true,
      storeZip: (policies.storeZip as string) ?? null,
      storeAddress: (policies.storeAddress as string) ?? null,
      storeMapsUrl: storeMapsUrl(policies), // link efetivo (explícito ou gerado)
    };
  });

  // GET /admin/segment-presets — tipos de negócio disponíveis (ADR-029)
  app.get("/segment-presets", async () => SEGMENT_PRESETS);

  // POST /admin/segment-config — segmento da loja + vocabulário + (opcional) voz da IA (ADR-029)
  app.post("/segment-config", adminOnly, async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      segment: z.string().min(2).max(40),
      styles: z.array(z.string()).optional(),
      occasions: z.array(z.string()).optional(),
      applyVoice: z.boolean().optional(), // setar agentTone = voz da IA do preset
      productionEnabled: z.boolean().optional(), // ADR-030: override manual do modo fabricação
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
    // Modo fabricação (ADR-030): override explícito tem prioridade; senão, deriva do preset.
    const productionEnabled = body.data.productionEnabled ?? preset?.production ?? false;
    data.productionEnabled = productionEnabled;

    await withTenant(tenant.id, async (tx) => {
      await tx.tenant.update({ where: { id: tenant.id }, data });
      await tx.domainEvent.create({
        data: { tenantId: tenant.id, type: "segment.configured", aggregateType: "tenant", aggregateId: tenant.id, payload: { segment, catalogVocab, voiceApplied } as any, actor: "operator" },
      });
    });
    return { ok: true, segment, catalogVocab, voiceApplied, productionEnabled };
  });

  // POST /admin/retention-config — política de retenção diferenciada (ADR-013). null = desativa.
  app.post("/retention-config", adminOnly, async (req, reply) => {
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
  app.post("/auto-approve", adminOnly, async (req, reply) => {
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
  app.post("/ai-toggle", adminOnly, async (req, reply) => {
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
  app.post("/identity/merge", adminOnly, async (req, reply) => {
    const body = z.object({ tenantSlug: z.string(), idA: z.string(), idB: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const tenant = await resolveTenant(body.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return mergeContactsByIds(body.data.tenantSlug, body.data.idA, body.data.idB, req.log);
  });
};
