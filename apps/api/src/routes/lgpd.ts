import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPrisma } from "@thepop/db";
import { exportContactData, eraseContact, previewRetention, runRetention } from "../services/lgpd-service.js";
import { verifyAuditChain } from "../services/audit-service.js";

async function tid(slug: string) {
  const t = await getPrisma().tenant.findUnique({ where: { slug } });
  return t?.id ?? null;
}

export const lgpdRoutes: FastifyPluginAsync = async (app) => {
  // GET /lgpd/export?tenantSlug=&contactId= — portabilidade
  app.get("/export", async (req, reply) => {
    const q = req.query as any;
    const id = await tid(q.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    const data = await exportContactData(id, q.contactId);
    if (!data) return reply.code(404).send({ error: "contact not found" });
    return data;
  });

  // POST /lgpd/erase — direito ao esquecimento (anonimização)
  app.post("/erase", async (req, reply) => {
    const body = z.object({ tenantSlug: z.string(), contactId: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const id = await tid(body.data.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    const ok = await eraseContact(id, body.data.contactId);
    return { ok, method: "anonymization" };
  });

  // GET /lgpd/retention/preview?tenantSlug= — quantas conversas/mensagens seriam anonimizadas
  app.get("/retention/preview", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return previewRetention(id);
  });

  // POST /lgpd/retention/run — executa a anonimização de retenção (manual)
  app.post("/retention/run", async (req, reply) => {
    const body = z.object({ tenantSlug: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const id = await tid(body.data.tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return runRetention(id);
  });

  // GET /lgpd/audit/verify?tenantSlug= — integridade da cadeia de auditoria
  app.get("/audit/verify", async (req, reply) => {
    const id = await tid((req.query as any).tenantSlug);
    if (!id) return reply.code(404).send({ error: "tenant not found" });
    return verifyAuditChain(id);
  });
};
