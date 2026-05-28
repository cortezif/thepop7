import type { FastifyPluginAsync } from "fastify";

// Stubs prontos para receber webhooks externos quando as credenciais chegarem.
// GET é o verification handshake do Meta; POST é o evento real.

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // ----- Meta (WhatsApp + Instagram) -----
  app.get("/meta", async (req, reply) => {
    const mode      = (req.query as any)["hub.mode"];
    const token     = (req.query as any)["hub.verify_token"];
    const challenge = (req.query as any)["hub.challenge"];
    if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      return reply.send(challenge);
    }
    return reply.code(403).send("forbidden");
  });

  app.post("/meta", async (req, reply) => {
    app.log.info({ body: req.body }, "Meta webhook received (not yet implemented)");
    return reply.send({ received: true });
  });

  // ----- Mercado Pago -----
  app.post("/mercadopago", async (req, reply) => {
    app.log.info({ body: req.body }, "Mercado Pago webhook received (not yet implemented)");
    return reply.send({ received: true });
  });

  // ----- Melhor Envio (tracking events) -----
  app.post("/melhor-envio", async (req, reply) => {
    app.log.info({ body: req.body }, "Melhor Envio webhook received (not yet implemented)");
    return reply.send({ received: true });
  });
};
