import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPrisma } from "@hubadvisor/db";
import { buildTrayAuthorizeUrl } from "@hubadvisor/connectors";
import {
  getTrayStatus, refreshTray, disconnectTray, saveTrayApiAddress,
  getMpStatus, refreshMp, disconnectMp, buildMpUrl,
  getMeStatus, refreshMe, disconnectMe, buildMeUrl,
  getBlingStatus, refreshBling, disconnectBling, buildBlingUrl,
  getOmieStatus, getVhsysStatus,
  getLalamoveStatus, getOpenDeliveryStatus,
  getWhatsAppStatus, getInstagramStatus, getCplugStatus, getAnthropicStatus,
  getProviderConfig, isAppConfigured, saveProviderConfig, getMaskedConfig, PROVIDER_FIELDS,
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
    const cfg = await getProviderConfig(tenant.id, "tray");
    const consumerKey = cfg.consumerKey ?? "";
    if (!consumerKey) return reply.code(400).send({ error: "Credenciais Tray não configuradas" });
    // Callback SEM query: a Tray anexa code/api_address com `?`, e um `?state=`
    // pré-existente quebraria a URL. Persistimos o web_api para o callback
    // resolver o tenant pelo api_address devolvido.
    await saveTrayApiAddress(tenant.id, q.data.apiAddress);
    const callbackUrl = `${publicBase(req as any).replace(/\/$/, "")}/api/auth/tray/callback`;
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
    if (!(await isAppConfigured(tenant.id, "mercadopago"))) return reply.code(400).send({ error: "Credenciais Mercado Pago não configuradas" });
    const redirectUri = `${publicBase(req as any).replace(/\/$/, "")}/api/auth/mercadopago/callback`;
    const url = await buildMpUrl(tenant.id, redirectUri, tenant.slug);
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
    if (!(await isAppConfigured(tenant.id, "melhor-envio"))) return reply.code(400).send({ error: "Credenciais Melhor Envio não configuradas" });
    const redirectUri = `${publicBase(req as any).replace(/\/$/, "")}/api/auth/melhor-envio/callback`;
    const url = await buildMeUrl(tenant.id, redirectUri, tenant.slug);
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

  // ── BLING (ERP — OAuth2) ─────────────────────────────────────────────────────
  app.get("/bling", async (req, reply) => {
    const tenant = await resolveTenant((req.query as any).tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return getBlingStatus(tenant.id);
  });

  app.get("/bling/authorize", async (req, reply) => {
    const q = z.object({ tenantSlug: z.string() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() });
    const tenant = await resolveTenant(q.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    if (!(await isAppConfigured(tenant.id, "bling"))) return reply.code(400).send({ error: "Credenciais Bling não configuradas" });
    const redirectUri = `${publicBase(req as any).replace(/\/$/, "")}/api/auth/bling/callback`;
    const url = await buildBlingUrl(tenant.id, redirectUri, tenant.slug);
    return { url };
  });

  app.post("/bling/refresh", async (req, reply) => {
    const tenant = await resolveTenant((req.body as any)?.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    try { return await refreshBling(tenant.id); }
    catch (e: any) { return reply.code(502).send({ error: e?.message ?? "falha ao renovar" }); }
  });

  app.post("/bling/disconnect", async (req, reply) => {
    const tenant = await resolveTenant((req.body as any)?.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return disconnectBling(tenant.id);
  });

  // ── STATUS: WhatsApp / Instagram / CPlug / Anthropic (token, por loja) ───────
  app.get("/whatsapp", async (req, reply) => {
    const t = await resolveTenant((req.query as any).tenantSlug);
    if (!t) return reply.code(404).send({ error: "tenant not found" });
    return getWhatsAppStatus(t.id);
  });
  app.get("/instagram", async (req, reply) => {
    const t = await resolveTenant((req.query as any).tenantSlug);
    if (!t) return reply.code(404).send({ error: "tenant not found" });
    return getInstagramStatus(t.id);
  });
  app.get("/cplug", async (req, reply) => {
    const t = await resolveTenant((req.query as any).tenantSlug);
    if (!t) return reply.code(404).send({ error: "tenant not found" });
    return getCplugStatus(t.id);
  });
  app.get("/anthropic", async (req, reply) => {
    const t = await resolveTenant((req.query as any).tenantSlug);
    if (!t) return reply.code(404).send({ error: "tenant not found" });
    return getAnthropicStatus(t.id);
  });
  app.get("/omie", async (req, reply) => {
    const t = await resolveTenant((req.query as any).tenantSlug);
    if (!t) return reply.code(404).send({ error: "tenant not found" });
    return getOmieStatus(t.id);
  });
  app.get("/vhsys", async (req, reply) => {
    const t = await resolveTenant((req.query as any).tenantSlug);
    if (!t) return reply.code(404).send({ error: "tenant not found" });
    return getVhsysStatus(t.id);
  });
  app.get("/lalamove", async (req, reply) => {
    const t = await resolveTenant((req.query as any).tenantSlug);
    if (!t) return reply.code(404).send({ error: "tenant not found" });
    return getLalamoveStatus(t.id);
  });
  app.get("/opendelivery", async (req, reply) => {
    const t = await resolveTenant((req.query as any).tenantSlug);
    if (!t) return reply.code(404).send({ error: "tenant not found" });
    return getOpenDeliveryStatus(t.id);
  });

  // ── CREDENCIAIS por loja (genérico p/ qualquer provider) ─────────────────────
  // GET  /integrations/:provider/config  → campos + valores mascarados + origem
  app.get("/:provider/config", async (req, reply) => {
    const provider = (req.params as any).provider as string;
    if (!PROVIDER_FIELDS[provider]) return reply.code(404).send({ error: "provider desconhecido" });
    const t = await resolveTenant((req.query as any).tenantSlug);
    if (!t) return reply.code(404).send({ error: "tenant not found" });
    return getMaskedConfig(t.id, provider);
  });

  // POST /integrations/:provider/config  { tenantSlug, values: {campo: valor} }
  //   - valor vazio/ausente remove a chave (volta ao fallback de env)
  app.post("/:provider/config", async (req, reply) => {
    const provider = (req.params as any).provider as string;
    if (!PROVIDER_FIELDS[provider]) return reply.code(404).send({ error: "provider desconhecido" });
    const body = z.object({
      tenantSlug: z.string(),
      values: z.record(z.string(), z.string().nullable()),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const t = await resolveTenant(body.data.tenantSlug);
    if (!t) return reply.code(404).send({ error: "tenant not found" });
    await saveProviderConfig(t.id, provider, body.data.values);
    return getMaskedConfig(t.id, provider);
  });
};
