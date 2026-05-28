import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPrisma } from "@thepop/db";
import { verifyPassword, hashPassword, signJwt, requireAuth } from "../auth.js";

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

    const token = signJwt({ sub: user.id, email: user.email, role: user.role, tenantId: tenant.id, tenantSlug: tenant.slug });
    return { token, tenantSlug: tenant.slug, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  });

  // POST /auth/signup — cadastro self-service de loja (cria tenant + owner). Aberta.
  app.post("/signup", async (req, reply) => {
    const body = z.object({
      storeName: z.string().min(2),
      slug: z.string().min(3).max(40).regex(/^[a-z0-9-]+$/, "use minúsculas, números e hífen"),
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(6, "mínimo 6 caracteres"),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const prisma = getPrisma();
    const slug = body.data.slug.toLowerCase();
    if (await prisma.tenant.findUnique({ where: { slug } })) {
      return reply.code(409).send({ error: "esse identificador de loja já existe" });
    }

    const email = body.data.email.toLowerCase().trim();
    const tenant = await prisma.tenant.create({
      data: {
        slug, name: body.data.storeName, status: "active",
        agentPersona: "Maya",
        agentTone: "Acolhedora, próxima, brasileira do dia a dia. Usa emojis com parcimônia.",
        policies: { prazoDevolucao: 7, cancelamentoSemPostagem: true },
        users: { create: { email, name: body.data.name, role: "owner", passwordHash: hashPassword(body.data.password) } },
      },
      include: { users: true },
    });

    const owner = tenant.users[0]!;
    const token = signJwt({ sub: owner.id, email: owner.email, role: owner.role, tenantId: tenant.id, tenantSlug: tenant.slug });
    return { token, tenantSlug: tenant.slug, user: { id: owner.id, name: owner.name, email: owner.email, role: owner.role } };
  });

  // GET /auth/me — valida o token e devolve o usuário (pro web saber se está logado)
  app.get("/me", { preHandler: requireAuth }, async (req) => {
    return { id: req.auth!.sub, email: req.auth!.email, role: req.auth!.role };
  });
};
