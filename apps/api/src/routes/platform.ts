import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { platformCommissionSummary } from "@hubadvisor/b2b";
import { getPrisma } from "@hubadvisor/db";
import { hashPassword } from "../auth.js";

// Rotas nível-PLATAFORMA (ADR-024) — não são do operador da loja. Gateadas por
// uma chave própria (`PLATFORM_ADMIN_KEY`) no header `x-platform-key`, separada
// do JWT de tenant. Sem a chave configurada no servidor, o painel fica indisponível.
//
// Aqui mora a gestão de LOJAS (tenants) pelo dono da plataforma: listar, criar
// (com o usuário owner) e suspender/reativar. Como roda fora do escopo de tenant,
// as queries usam o prisma cru (cross-tenant) — é o único lugar autorizado a isso.
const STATUSES = ["active", "suspended", "trial"] as const;

export const platformRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (req, reply) => {
    const expected = process.env.PLATFORM_ADMIN_KEY;
    if (!expected) return reply.code(503).send({ error: "painel da plataforma desabilitado (defina PLATFORM_ADMIN_KEY)" });
    if ((req.headers["x-platform-key"] as string) !== expected) return reply.code(401).send({ error: "chave de plataforma inválida" });
  });

  // GET /platform/commissions — receita de comissões B2B (cross-tenant)
  app.get("/commissions", async () => platformCommissionSummary());

  // GET /platform/tenants — todas as lojas com contagens e o dono
  app.get("/tenants", async () => {
    const tenants = await getPrisma().tenant.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        users: { orderBy: { createdAt: "asc" } },
        _count: { select: { users: true, orders: true, products: true } },
      },
    });
    return tenants.map((t) => {
      const owner = t.users.find((u) => u.role === "owner") ?? t.users[0];
      return {
        id: t.id, slug: t.slug, name: t.name, status: t.status, segment: t.segment,
        productionEnabled: t.productionEnabled, createdAt: t.createdAt,
        ownerName: owner?.name ?? null, ownerEmail: owner?.email ?? null,
        users: t._count.users, orders: t._count.orders, products: t._count.products,
      };
    });
  });

  // POST /platform/tenants — cria uma loja + usuário owner (onboarding pela plataforma)
  app.post("/tenants", async (req, reply) => {
    const body = z.object({
      storeName: z.string().min(2),
      slug: z.string().min(3).max(40).regex(/^[a-z0-9-]+$/, "use minúsculas, números e hífen"),
      ownerName: z.string().min(2),
      ownerEmail: z.string().email(),
      password: z.string().min(6, "mínimo 6 caracteres"),
      status: z.enum(STATUSES).default("active"),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const prisma = getPrisma();
    const slug = body.data.slug.toLowerCase();
    if (await prisma.tenant.findUnique({ where: { slug } })) {
      return reply.code(409).send({ error: "esse identificador de loja já existe" });
    }
    const tenant = await prisma.tenant.create({
      data: {
        slug, name: body.data.storeName, status: body.data.status,
        agentPersona: "Maya",
        agentTone: "Acolhedora, próxima, brasileira do dia a dia. Usa emojis com parcimônia.",
        policies: { prazoDevolucao: 7, cancelamentoSemPostagem: true },
        users: {
          create: {
            email: body.data.ownerEmail.toLowerCase().trim(),
            name: body.data.ownerName.trim(),
            role: "owner",
            passwordHash: hashPassword(body.data.password),
          },
        },
      },
    });
    req.log.info({ tenant: tenant.id, slug }, "loja criada pela plataforma");
    return reply.code(201).send({ id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status });
  });

  // POST /platform/tenants/:id/status — suspende / reativa / coloca em trial
  app.post("/tenants/:id/status", async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const body = z.object({ status: z.enum(STATUSES) }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "entrada inválida" });

    const prisma = getPrisma();
    const tenant = await prisma.tenant.findUnique({ where: { id: params.data.id } });
    if (!tenant) return reply.code(404).send({ error: "loja não encontrada" });

    await prisma.tenant.update({ where: { id: tenant.id }, data: { status: body.data.status } });
    req.log.warn({ tenant: tenant.id, status: body.data.status }, "status da loja alterado pela plataforma");
    return { ok: true, id: tenant.id, status: body.data.status };
  });
};
