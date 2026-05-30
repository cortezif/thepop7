import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPrisma } from "@hubadvisor/db";
import { buildTrayAuthorizeUrl } from "@hubadvisor/connectors";
import {
  getTrayStatus, refreshTray, disconnectTray,
  getMpStatus, refreshMp, disconnectMp, buildMpUrl, mpAppConfigured,
  getMeStatus, refreshMe, disconnectMe, buildMeUrl, meAppConfigured,
  getWhatsAppStatus, getInstagramStatus, getCplugStatus, getAnthropicStatus,
} from "../services/integration-service.js";

async function resolveTenant(slug: string) {
  return getPrisma().tenant.findUnique({ where: { slug } });
}

function publicBase(req: { protocol: string; hostname: string; headers: Record<string, unknown> }): string {
  return process.env.APP_PUBLIC_URL
    ?? `${req.protocol}://${(req.headers["host"] as string) ?? req.hostname}`;
}

export const integrationRoutes: FastifyPluginAsync = async (app) => {

  // ── TRAY ────────────────────────────────────────────────────────────────────
  app.get("/tray", async (req) => {
    const tenant = await resolveTenant((req.query as any).tenantSlug);
    if (!tenant) throw { statusCode: 404, message: "tenant not found" };
    return getTrayStatus(tenant.id);
  });

  app.get("/tray/authorize", async (req, reply) => {
    const q = z.object({ tenantSlug: z.string(), apiAddress: z.string().url() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() });
    const tenant = await resolveTenant(q.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    const consumerKey = process.env.TRAY_CONSUMER_KEY ?? "";
    if (!consumerKey) return reply.code(400).send({ error: "TRAY_CONSUMER_KEY não configurado" });
    const callbackUrl = `${publicBase(req as any).replace(/\/$/, "")}/api/auth/tray/callback?state=${encodeURIComponent(tenant.slug)}`;
    const url = buildTrayAuthorizeUrl({ apiAddress: q.data.apiAddress, consumerKey, callbackUrl });
    return { url };
  });

  app.post("/tray/refresh", async (req, reply) => {
    const tenant = await resolveTenant((req.body as any)?.tenantSlug ?? (req.query as any)?.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    try { return await refreshTray(tenant.id); }
    catch (e: any) { return reply.code(502).send({ error: e?.message ?? "falha ao renovar" }); }
  });

  app.post("/tray/disconnect", async (req, reply) => {
    const tenant = await resolveTenant((req.body as any)?.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return disconnectTray(tenant.id);
  });

  // ── MERCADO PAGO ─────────────────────────────────────────────────────────────
  app.get("/mercadopago", async (req, reply) => {
    const tenant = await resolveTenant((req.query as any).tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return getMpStatus(tenant.id);
  });

  app.get("/mercadopago/authorize", async (req, reply) => {
    const q = z.object({ tenantSlug: z.string() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() });
    const tenant = await resolveTenant(q.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    if (!mpAppConfigured()) return reply.code(400).send({ error: "MERCADOPAGO_APP_ID/SECRET não configurados" });
    const redirectUri = `${publicBase(req as any).replace(/\/$/, "")}/api/auth/mercadopago/callback`;
    const url = buildMpUrl(redirectUri, tenant.slug);
    return { url };
  });

  app.post("/mercadopago/refresh", async (req, reply) => {
    const tenant = await resolveTenant((req.body as any)?.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    try { return await refreshMp(tenant.id); }
    catch (e: any) { return reply.code(502).send({ error: e?.message ?? "falha ao renovar" }); }
  });

  app.post("/mercadopago/disconnect", async (req, reply) => {
    const tenant = await resolveTenant((req.body as any)?.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return disconnectMp(tenant.id);
  });

  // ── MELHOR ENVIO ─────────────────────────────────────────────────────────────
  app.get("/melhor-envio", async (req, reply) => {
    const tenant = await resolveTenant((req.query as any).tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return getMeStatus(tenant.id);
  });

  app.get("/melhor-envio/authorize", async (req, reply) => {
    const q = z.object({ tenantSlug: z.string() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() });
    const tenant = await resolveTenant(q.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    if (!meAppConfigured()) return reply.code(400).send({ error: "MELHORENVIO_CLIENT_ID/SECRET não configurados" });
    const redirectUri = `${publicBase(req as any).replace(/\/$/, "")}/api/auth/melhor-envio/callback`;
    const url = buildMeUrl(redirectUri, tenant.slug);
    return { url };
  });

  app.post("/melhor-envio/refresh", async (req, reply) => {
    const tenant = await resolveTenant((req.body as any)?.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    try { return await refreshMe(tenant.id); }
    catch (e: any) { return reply.code(502).send({ error: e?.message ?? "falha ao renovar" }); }
  });

  app.post("/melhor-envio/disconnect", async (req, reply) => {
    const tenant = await resolveTenant((req.body as any)?.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return disconnectMe(tenant.id);
  });

  // ── STATUS: WhatsApp / Instagram / CPlug / Anthropic (env-var only) ──────────
  app.get("/whatsapp", async () => getWhatsAppStatus());
  app.get("/instagram", async () => getInstagramStatus());
  app.get("/cplug", async () => getCplugStatus());
  app.get("/anthropic", async () => getAnthropicStatus());
};
