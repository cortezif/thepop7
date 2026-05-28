import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPrisma } from "@thepop/db";
import { verifyPassword, signJwt, requireAuth } from "../auth.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  // POST /auth/login — { tenantSlug, email, password } → { token, user }
  app.post("/login", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      email: z.string(),
      password: z.string(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const prisma = getPrisma();
    const tenant = await prisma.tenant.findUnique({ where: { slug: body.data.tenantSlug } });
    if (!tenant) return reply.code(401).send({ error: "credenciais inválidas" });

    const user = await prisma.user.findFirst({
      where: { tenantId: tenant.id, email: body.data.email.toLowerCase().trim() },
    });
    if (!user || !verifyPassword(body.data.password, user.passwordHash)) {
      return reply.code(401).send({ error: "credenciais inválidas" });
    }

    const token = signJwt({ sub: user.id, email: user.email, role: user.role, tenantId: tenant.id });
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  });

  // GET /auth/me — valida o token e devolve o usuário (pro web saber se está logado)
  app.get("/me", { preHandler: requireAuth }, async (req) => {
    return { id: req.auth!.sub, email: req.auth!.email, role: req.auth!.role };
  });
};
