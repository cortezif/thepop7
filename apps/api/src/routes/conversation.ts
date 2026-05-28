import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { handleIncomingMessage } from "../services/conversation-service.js";
import { dryRunConversation } from "../services/dry-run-service.js";

const incomingMsgSchema = z.object({
  tenantSlug: z.string(),
  channel:    z.enum(["whatsapp", "instagram", "manual"]).default("manual"),
  contact: z.object({
    phone:    z.string().optional(),
    igHandle: z.string().optional(),
    name:     z.string().optional(),
  }),
  text: z.string().min(1),
});

const dryRunSchema = z.object({
  text: z.string().min(1),
  contactName: z.string().optional(),
  recentMessages: z.array(z.object({
    direction: z.enum(["in", "out"]),
    text: z.string(),
  })).optional(),
});

export const conversationRoutes: FastifyPluginAsync = async (app) => {
  // Endpoint que usa DB + persiste (precisa de Postgres + bootstrap).
  app.post("/incoming", async (req, reply) => {
    const parsed = incomingMsgSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await handleIncomingMessage(parsed.data, app.log);
    return result;
  });

  // Modo dry-run sem DB: só agente + mocks + ANTHROPIC_API_KEY.
  // Ideal pra validar Anthropic e tools antes de subir Docker.
  app.post("/dry-run", async (req, reply) => {
    const parsed = dryRunSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await dryRunConversation(parsed.data, app.log);
      return result;
    } catch (e: any) {
      app.log.error(e, "dry-run failed");
      return reply.code(500).send({ error: e?.message ?? String(e) });
    }
  });
};
