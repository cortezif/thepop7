import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  listContacts, contactStats, createContactManual, updateContactConsent, updateContactTags,
  getContactDetail, updateContactProfile,
} from "../services/contact-service.js";
import { CUSTOMER_TAG_KEYS } from "@hubadvisor/shared";

// Cadastro de clientes / CRM (ADR-031/039). Protegido por JWP (bloco `secure`).

const OPT_OUTS = ["marketing", "nps", "recompra"] as const;

// Cadastro completo do cliente (ADR-039): contato + endereço estruturado.
const profileFields = {
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  igHandle: z.string().optional(),
  cpf: z.string().optional(),
  cep: z.string().optional(),
  street: z.string().optional(),
  number: z.string().optional(),
  complement: z.string().optional(),
  district: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  consentLGPD: z.boolean().optional(),
};

export const contactRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    const q = req.query as any;
    return listContacts(req.auth!.tenantId, {
      q: typeof q?.q === "string" ? q.q : undefined,
      optedOutMarketing: q?.optedOut === "true",
      withCashback: q?.withCashback === "true",
    });
  });

  app.get("/stats", async (req) => contactStats(req.auth!.tenantId));

  app.post("/", async (req, reply) => {
    const body = z.object({ tenantSlug: z.string(), ...profileFields }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    if (!body.data.phone && !body.data.email && !body.data.igHandle) {
      return reply.code(400).send({ error: "informe telefone, e-mail ou Instagram" });
    }
    return createContactManual(req.auth!.tenantId, body.data);
  });

  // GET /:id — cadastro completo (decifrado) p/ preencher o editor.
  app.get("/:id", async (req, reply) => {
    const c = await getContactDetail(req.auth!.tenantId, (req.params as any).id);
    if (!c) return reply.code(404).send({ error: "contato não encontrado" });
    return c;
  });

  // PATCH /:id — edita o cadastro completo (contato + endereço).
  app.patch("/:id", async (req, reply) => {
    const body = z.object({ tenantSlug: z.string(), ...profileFields }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      return await updateContactProfile(req.auth!.tenantId, (req.params as any).id, body.data);
    } catch (e: any) {
      return reply.code(404).send({ error: e?.message ?? "contato não encontrado" });
    }
  });

  app.patch("/:id/consent", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      consentLGPD: z.boolean().optional(),
      optOuts: z.array(z.enum(OPT_OUTS)).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      return await updateContactConsent(req.auth!.tenantId, (req.params as any).id, body.data);
    } catch (e: any) {
      return reply.code(404).send({ error: e?.message ?? "contato não encontrado" });
    }
  });

  // PATCH /:id/tags — perfil/classificação do cliente (ADR-036).
  app.patch("/:id/tags", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      tags: z.array(z.enum(CUSTOMER_TAG_KEYS as [string, ...string[]])),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      return await updateContactTags(req.auth!.tenantId, (req.params as any).id, body.data.tags);
    } catch (e: any) {
      return reply.code(404).send({ error: e?.message ?? "contato não encontrado" });
    }
  });
};
