import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPrisma } from "@thepop/db";
import { buildTrayAuthorizeUrl } from "@thepop/connectors";
import {
  getTrayStatus, refreshTray, disconnectTray,
} from "../services/integration-service.js";

async function resolveTenant(slug: string) {
  return getPrisma().tenant.findUnique({ where: { slug } });
}

/** URL pública do callback: APP_PUBLIC_URL/api/auth/tray/callback (com fallback do request). */
function callbackUrl(req: { protocol: string; hostname: string; headers: Record<string, unknown> }): string {
  const base = process.env.APP_PUBLIC_URL
    ?? `${req.protocol}://${(req.headers["host"] as string) ?? req.hostname}`;
  return `${base.replace(/\/$/, "")}/api/auth/tray/callback`;
}

export const integrationRoutes: FastifyPluginAsync = async (app) => {
  // GET /integrations/tray — status (sem tokens)
  app.get("/tray", async (req, reply) => {
    const tenant = await resolveTenant((req.query as any).tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return getTrayStatus(tenant.id);
  });

  // GET /integrations/tray/authorize?apiAddress=... — monta a URL de autorização
  // (passo 1). O lojista informa a web_api da loja; abrimos essa URL pra ele
  // autorizar e a Tray volta no nosso callback com o `code`.
  app.get("/tray/authorize", async (req, reply) => {
    const q = z.object({
      tenantSlug: z.string(),
      apiAddress: z.string().url("informe a URL web_api da loja"),
    }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() });
    const tenant = await resolveTenant(q.data.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });

    const consumerKey = process.env.TRAY_CONSUMER_KEY ?? "";
    if (!consumerKey) return reply.code(400).send({ error: "TRAY_CONSUMER_KEY não configurado" });

    const url = buildTrayAuthorizeUrl({
      apiAddress: q.data.apiAddress,
      consumerKey,
      // carrega o tenant no state pra o callback saber a quem pertence
      callbackUrl: `${callbackUrl(req as any)}?state=${encodeURIComponent(tenant.slug)}`,
    });
    return { url };
  });

  // POST /integrations/tray/refresh — renova o access_token
  app.post("/tray/refresh", async (req, reply) => {
    const tenant = await resolveTenant((req.body as any)?.tenantSlug ?? (req.query as any)?.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    try {
      return await refreshTray(tenant.id);
    } catch (e: any) {
      return reply.code(502).send({ error: e?.message ?? "falha ao renovar" });
    }
  });

  // POST /integrations/tray/disconnect — apaga os tokens
  app.post("/tray/disconnect", async (req, reply) => {
    const tenant = await resolveTenant((req.body as any)?.tenantSlug);
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return disconnectTray(tenant.id);
  });
};
