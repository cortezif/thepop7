import type { FastifyPluginAsync } from "fastify";
import { platformCommissionSummary } from "@thepop/b2b";

// Rotas nível-PLATAFORMA (ADR-024) — não são do operador da loja. Gateadas por
// uma chave própria (`PLATFORM_ADMIN_KEY`) no header `x-platform-key`, separada
// do JWT de tenant. Sem a chave configurada no servidor, o painel fica indisponível.
export const platformRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (req, reply) => {
    const expected = process.env.PLATFORM_ADMIN_KEY;
    if (!expected) return reply.code(503).send({ error: "painel da plataforma desabilitado (defina PLATFORM_ADMIN_KEY)" });
    if ((req.headers["x-platform-key"] as string) !== expected) return reply.code(401).send({ error: "chave de plataforma inválida" });
  });

  // GET /platform/commissions — receita de comissões B2B (cross-tenant)
  app.get("/commissions", async () => platformCommissionSummary());
};
