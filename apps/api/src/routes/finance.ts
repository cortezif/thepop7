import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { cashflow, listEntries, createEntry, deleteEntry, monthKey } from "../services/finance-service.js";

// Financeiro / fluxo de caixa (ADR-032). Protegido por JWP (bloco `secure`).

export const financeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/cashflow", async (req) => {
    const month = (req.query as any)?.month || monthKey(new Date());
    return cashflow(req.auth!.tenantId, month);
  });

  app.get("/entries", async (req) => {
    const month = (req.query as any)?.month || monthKey(new Date());
    return listEntries(req.auth!.tenantId, month);
  });

  app.post("/entries", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      type: z.enum(["receita", "despesa"]),
      category: z.string().min(1),
      description: z.string().nullable().optional(),
      amountBRL: z.number().positive(),
      date: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    return createEntry(req.auth!.tenantId, {
      type: body.data.type,
      category: body.data.category,
      description: body.data.description ?? undefined,
      amountBRL: body.data.amountBRL,
      date: body.data.date,
    });
  });

  app.delete("/entries/:id", async (req, reply) => {
    try {
      return await deleteEntry(req.auth!.tenantId, (req.params as any).id);
    } catch (e: any) {
      return reply.code(404).send({ error: e?.message ?? "não encontrado" });
    }
  });
};
