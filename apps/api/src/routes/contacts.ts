import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  listContacts, contactStats, createContactManual, updateContactConsent,
} from "../services/contact-service.js";

// Cadastro de clientes / CRM (ADR-031). Protegido por JWP (bloco `secure`).

const OPT_OUTS = ["marketing", "nps", "recompra"] as const;

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
    const body = z.object({
      tenantSlug: z.string(),
      name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      igHandle: z.string().optional(),
      consentLGPD: z.boolean().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    if (!body.data.phone && !body.data.email && !body.data.igHandle) {
      return reply.code(400).send({ error: "informe telefone, e-mail ou Instagram" });
    }
    return createContactManual(req.auth!.tenantId, body.data);
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
};
