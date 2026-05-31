import type { FastifyPluginAsync } from "fastify";
import { liveDashboardByToken } from "../services/dashboard-service.js";

// Wallboard de TV por token (ADR-040): rota PÚBLICA, sem auth — a TV abre o link
// e fica atualizando sozinha. Padrão igual ao app do entregador (/entregador/:token).

export const tvPublicRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:token", async (req, reply) => {
    const data = await liveDashboardByToken((req.params as any).token as string);
    if (!data) return reply.code(404).send({ error: "link inválido ou desativado" });
    // a TV reconsulta sozinha; evita cache intermediário servir dado velho.
    reply.header("Cache-Control", "no-store");
    return data;
  });
};
