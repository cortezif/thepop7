import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPrisma } from "@hubadvisor/db";
import { verifyPassword, hashPassword, signJwt, requireAuth } from "../auth.js";
import {
  connectTrayFromCallback,
  connectMpFromCallback,
  connectMeFromCallback,
  connectBlingFromCallback,
} from "../services/integration-service.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  // POST /auth/login — { email, password, tenantSlug? } → { token, user }
  // Login por e-mail: o e-mail é único POR loja (@@unique([tenantId, email])),
  // então o mesmo e-mail pode existir em várias lojas. Resolvemos a loja
  // automaticamente; só pedimos seleção quando e-mail+senha batem em mais de
  // uma. `tenantSlug` é opcional — usado quando o usuário escolhe no seletor.
  app.post("/login", async (req, reply) => {
    const body = z.object({
      email: z.string(),
      password: z.string(),
      tenantSlug: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const prisma = getPrisma();
    const email = body.data.email.toLowerCase().trim();

    // Candidatos: usuários com esse e-mail (em uma ou mais lojas). Se o seletor
    // mandou um slug, restringimos a essa loja.
    const candidates = await prisma.user.findMany({
      where: {
        email,
        ...(body.data.tenantSlug ? { tenant: { slug: body.data.tenantSlug.toLowerCase() } } : {}),
      },
      include: { tenant: true },
    });

    // Só consideramos lojas onde a SENHA também bate (não vazamos em quais
    // lojas o e-mail existe sem credencial válida).
    const matched = candidates.filter((u) => verifyPassword(body.data.password, u.passwordHash));
    if (matched.length === 0) return reply.code(401).send({ error: "credenciais inválidas" });

    // E-mail+senha válidos em mais de uma loja → pedir seleção.
    if (matched.length > 1) {
      return {
        needsTenantSelection: true,
        tenants: matched.map((u) => ({ slug: u.tenant.slug, name: u.tenant.name })),
      };
    }

    const user = matched[0]!;
    const tenant = user.tenant;
    const token = signJwt({ sub: user.id, email: user.email, role: user.role, tenantId: tenant.id, tenantSlug: tenant.slug });
    return {
      token, tenantSlug: tenant.slug,
      tenant: { slug: tenant.slug, name: tenant.name },
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
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
    return {
      token, tenantSlug: tenant.slug,
      tenant: { slug: tenant.slug, name: tenant.name },
      user: { id: owner.id, name: owner.name, email: owner.email, role: owner.role },
    };
  });

  // GET /auth/me — valida o token e devolve o usuário + a loja (marca) da sessão.
  app.get("/me", { preHandler: requireAuth }, async (req) => {
    const tenant = await getPrisma().tenant.findUnique({ where: { id: req.auth!.tenantId } });
    return {
      id: req.auth!.sub, email: req.auth!.email, role: req.auth!.role,
      tenant: tenant ? { slug: tenant.slug, name: tenant.name } : null,
    };
  });

  // GET /auth/tray/callback — callback OAuth da Tray (passo 2). Aberta: a Tray
  // redireciona o NAVEGADOR do lojista pra cá com code + api_address. O tenant
  // vem no `state` (slug) que mandamos na URL de autorização. Troca o code por
  // tokens, persiste cifrado e redireciona de volta pro painel.
  app.get("/tray/callback", async (req, reply) => {
    const q = z.object({
      code: z.string().min(1),
      api_address: z.string().url(),
      state: z.string().optional(), // slug do tenant
    }).safeParse(req.query);
    const redirectBase = "/settings";
    if (!q.success) return reply.redirect(`${redirectBase}?tray=erro&motivo=callback_invalido`);

    const slug = (q.data.state ?? "thepop7").toLowerCase();
    const tenant = await getPrisma().tenant.findUnique({ where: { slug } });
    if (!tenant) return reply.redirect(`${redirectBase}?tray=erro&motivo=loja_nao_encontrada`);

    try {
      await connectTrayFromCallback(tenant.id, q.data.code, q.data.api_address);
      return reply.redirect(`${redirectBase}?tray=ok`);
    } catch (e: any) {
      req.log.error(e, "tray callback falhou");
      return reply.redirect(`${redirectBase}?tray=erro&motivo=${encodeURIComponent(e?.message ?? "falha")}`);
    }
  });

  // GET /auth/mercadopago/callback
  app.get("/mercadopago/callback", async (req, reply) => {
    const q = z.object({ code: z.string().min(1), state: z.string().optional() }).safeParse(req.query);
    const redirectBase = "/settings";
    if (!q.success) return reply.redirect(`${redirectBase}?mp=erro&motivo=callback_invalido`);
    const slug = (q.data.state ?? "thepop7").toLowerCase();
    const tenant = await getPrisma().tenant.findUnique({ where: { slug } });
    if (!tenant) return reply.redirect(`${redirectBase}?mp=erro&motivo=loja_nao_encontrada`);
    try {
      const base = process.env.APP_PUBLIC_URL ?? `${(req as any).protocol}://${(req.headers as any)["host"]}`;
      const redirectUri = `${base.replace(/\/$/, "")}/api/auth/mercadopago/callback`;
      await connectMpFromCallback(tenant.id, q.data.code, redirectUri);
      return reply.redirect(`${redirectBase}?mp=ok`);
    } catch (e: any) {
      req.log.error(e, "mercadopago callback falhou");
      return reply.redirect(`${redirectBase}?mp=erro&motivo=${encodeURIComponent(e?.message ?? "falha")}`);
    }
  });

  // GET /auth/bling/callback — callback OAuth2 do Bling (ADR-004). O tenant vem
  // no `state` (slug). Troca o code por tokens, persiste cifrado e volta ao painel.
  app.get("/bling/callback", async (req, reply) => {
    const q = z.object({ code: z.string().min(1), state: z.string().optional() }).safeParse(req.query);
    const redirectBase = "/settings";
    if (!q.success) return reply.redirect(`${redirectBase}?bling=erro&motivo=callback_invalido`);
    const slug = (q.data.state ?? "thepop7").toLowerCase();
    const tenant = await getPrisma().tenant.findUnique({ where: { slug } });
    if (!tenant) return reply.redirect(`${redirectBase}?bling=erro&motivo=loja_nao_encontrada`);
    try {
      const base = process.env.APP_PUBLIC_URL ?? `${(req as any).protocol}://${(req.headers as any)["host"]}`;
      const redirectUri = `${base.replace(/\/$/, "")}/api/auth/bling/callback`;
      await connectBlingFromCallback(tenant.id, q.data.code, redirectUri);
      return reply.redirect(`${redirectBase}?bling=ok`);
    } catch (e: any) {
      req.log.error(e, "bling callback falhou");
      return reply.redirect(`${redirectBase}?bling=erro&motivo=${encodeURIComponent(e?.message ?? "falha")}`);
    }
  });

  // GET /auth/melhor-envio/callback
  app.get("/melhor-envio/callback", async (req, reply) => {
    const q = z.object({ code: z.string().min(1), state: z.string().optional() }).safeParse(req.query);
    const redirectBase = "/settings";
    if (!q.success) return reply.redirect(`${redirectBase}?me=erro&motivo=callback_invalido`);
    const slug = (q.data.state ?? "thepop7").toLowerCase();
    const tenant = await getPrisma().tenant.findUnique({ where: { slug } });
    if (!tenant) return reply.redirect(`${redirectBase}?me=erro&motivo=loja_nao_encontrada`);
    try {
      const base = process.env.APP_PUBLIC_URL ?? `${(req as any).protocol}://${(req.headers as any)["host"]}`;
      const redirectUri = `${base.replace(/\/$/, "")}/api/auth/melhor-envio/callback`;
      await connectMeFromCallback(tenant.id, q.data.code, redirectUri);
      return reply.redirect(`${redirectBase}?me=ok`);
    } catch (e: any) {
      req.log.error(e, "melhor-envio callback falhou");
      return reply.redirect(`${redirectBase}?me=erro&motivo=${encodeURIComponent(e?.message ?? "falha")}`);
    }
  });
};
