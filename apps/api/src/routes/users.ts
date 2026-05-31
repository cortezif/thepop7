import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPrisma } from "@hubadvisor/db";
import { hashPassword, requireRole } from "../auth.js";

/* ============================================================
   Gestão de equipe (F2 / ADR-013) — usuários DENTRO de uma loja.
   Escopo sempre o tenant do token (req.auth.tenantId); nunca aceita
   tenant de fora. Gateado por papel: owner/admin gerenciam a equipe;
   operator não enxerga estas rotas. Regras de segurança:
     - só owner cria/concede/revoga o papel `owner`;
     - admin não mexe em quem é owner;
     - nunca remove/rebaixa o ÚLTIMO owner (loja não fica órfã);
     - ninguém remove a própria conta por aqui.
   ============================================================ */

const ROLES = ["owner", "admin", "operator"] as const;

function view(u: { id: string; name: string; email: string; role: string; createdAt: Date }) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt };
}

export const userRoutes: FastifyPluginAsync = async (app) => {
  // Toda a gestão de equipe exige owner ou admin.
  app.addHook("preHandler", requireRole("owner", "admin"));

  // GET /users — lista a equipe da loja
  app.get("/", async (req) => {
    const users = await getPrisma().user.findMany({
      where: { tenantId: req.auth!.tenantId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });
    return users.map(view);
  });

  // POST /users — cria um novo membro da equipe
  app.post("/", async (req, reply) => {
    const body = z.object({
      name: z.string().min(2),
      email: z.string().email(),
      role: z.enum(ROLES).default("operator"),
      password: z.string().min(6, "mínimo 6 caracteres"),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    // Só owner pode criar outro owner.
    if (body.data.role === "owner" && req.auth!.role !== "owner") {
      return reply.code(403).send({ error: "apenas o dono pode criar outro dono" });
    }

    const prisma = getPrisma();
    const email = body.data.email.toLowerCase().trim();
    const exists = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: req.auth!.tenantId, email } },
    });
    if (exists) return reply.code(409).send({ error: "já existe um usuário com esse e-mail nesta loja" });

    const user = await prisma.user.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: body.data.name.trim(),
        email,
        role: body.data.role,
        passwordHash: hashPassword(body.data.password),
      },
    });
    req.log.info({ actor: req.auth!.sub, created: user.id, role: user.role }, "usuário criado");
    return reply.code(201).send(view(user));
  });

  // PATCH /users/:id — altera nome e/ou papel
  app.patch("/:id", async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const body = z.object({
      name: z.string().min(2).optional(),
      role: z.enum(ROLES).optional(),
    }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "entrada inválida" });

    const prisma = getPrisma();
    const target = await prisma.user.findFirst({
      where: { id: params.data.id, tenantId: req.auth!.tenantId },
    });
    if (!target) return reply.code(404).send({ error: "usuário não encontrado" });

    // Mexer em um owner (ou conceder owner) é privilégio do owner.
    const touchesOwner = target.role === "owner" || body.data.role === "owner";
    if (touchesOwner && req.auth!.role !== "owner") {
      return reply.code(403).send({ error: "apenas o dono pode gerenciar donos" });
    }

    // Não rebaixar o último owner da loja.
    if (target.role === "owner" && body.data.role && body.data.role !== "owner") {
      const owners = await prisma.user.count({ where: { tenantId: req.auth!.tenantId, role: "owner" } });
      if (owners <= 1) return reply.code(409).send({ error: "a loja precisa de ao menos um dono" });
    }

    const data: { name?: string; role?: (typeof ROLES)[number] } = {};
    if (body.data.name) data.name = body.data.name.trim();
    if (body.data.role) data.role = body.data.role;
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "nada para atualizar" });

    const updated = await prisma.user.update({ where: { id: target.id }, data });
    return view(updated);
  });

  // POST /users/:id/password — redefine a senha de um membro
  app.post("/:id/password", async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const body = z.object({ password: z.string().min(6, "mínimo 6 caracteres") }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "entrada inválida" });

    const prisma = getPrisma();
    const target = await prisma.user.findFirst({
      where: { id: params.data.id, tenantId: req.auth!.tenantId },
    });
    if (!target) return reply.code(404).send({ error: "usuário não encontrado" });
    if (target.role === "owner" && req.auth!.role !== "owner") {
      return reply.code(403).send({ error: "apenas o dono redefine a senha de um dono" });
    }

    await prisma.user.update({ where: { id: target.id }, data: { passwordHash: hashPassword(body.data.password) } });
    req.log.info({ actor: req.auth!.sub, target: target.id }, "senha redefinida");
    return { ok: true };
  });

  // DELETE /users/:id — remove um membro
  app.delete("/:id", async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "entrada inválida" });
    if (params.data.id === req.auth!.sub) return reply.code(409).send({ error: "você não pode remover a própria conta" });

    const prisma = getPrisma();
    const target = await prisma.user.findFirst({
      where: { id: params.data.id, tenantId: req.auth!.tenantId },
    });
    if (!target) return reply.code(404).send({ error: "usuário não encontrado" });

    if (target.role === "owner") {
      if (req.auth!.role !== "owner") return reply.code(403).send({ error: "apenas o dono remove um dono" });
      const owners = await prisma.user.count({ where: { tenantId: req.auth!.tenantId, role: "owner" } });
      if (owners <= 1) return reply.code(409).send({ error: "a loja precisa de ao menos um dono" });
    }

    await prisma.user.delete({ where: { id: target.id } });
    req.log.info({ actor: req.auth!.sub, removed: target.id }, "usuário removido");
    return { ok: true };
  });
};
