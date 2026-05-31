import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../auth.js";
import { liveDashboard, getTvToken, ensureTvToken, resetTvToken, disableTvToken } from "../services/dashboard-service.js";

// Wallboard ao vivo (ADR-040). Protegido por JWP (bloco `secure`). O link público
// da TV (token) é gerido só por owner/admin.

const manageOnly = { preHandler: requireRole("owner", "admin") };

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  // GET /dashboard/live — wallboard do dia (qualquer usuário autenticado da loja).
  app.get("/live", async (req) => liveDashboard(req.auth!.tenantId));

  // GET /dashboard/tv-link — token atual do link público da TV (ou null).
  app.get("/tv-link", manageOnly, async (req) => ({ token: await getTvToken(req.auth!.tenantId) }));

  // POST /dashboard/tv-link — ativa o link (gera se não houver).
  app.post("/tv-link", manageOnly, async (req) => ({ token: await ensureTvToken(req.auth!.tenantId) }));

  // POST /dashboard/tv-link/reset — gera um token novo (revoga o anterior).
  app.post("/tv-link/reset", manageOnly, async (req) => ({ token: await resetTvToken(req.auth!.tenantId) }));

  // DELETE /dashboard/tv-link — desativa o link público.
  app.delete("/tv-link", manageOnly, async (req) => { await disableTvToken(req.auth!.tenantId); return { ok: true }; });
};
