import Fastify from "fastify";
import { healthRoutes }       from "./routes/health.js";
import { conversationRoutes } from "./routes/conversation.js";
import { webhookRoutes }      from "./routes/webhooks.js";
import { catalogRoutes }      from "./routes/catalog.js";
import { catalogEnrichmentRoutes } from "./routes/catalog-enrichment.js";
import { adminRoutes } from "./routes/admin.js";
import { inboxRoutes } from "./routes/inbox.js";
import { metricsRoutes } from "./routes/metrics.js";
import { postSaleRoutes } from "./routes/post-sale.js";
import { orderRoutes } from "./routes/orders.js";
import { purchasingRoutes } from "./routes/purchasing.js";
import { lgpdRoutes } from "./routes/lgpd.js";

export function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      // LGPD (ADR-013): redige dados pessoais dos logs. Cobre os formatos que
      // a gente loga hoje (perfil com medidas, CEP, payloads de webhook).
      redact: {
        censor: "[PII]",
        paths: [
          "phone", "email", "cpf", "cep", "document",
          "*.phone", "*.email", "*.cpf", "*.cep", "*.document", "*.contactPhone",
          "*.*.phone", "*.*.email", "*.*.cpf", "*.*.cep",
          // Perfil da cliente (medidas corporais são dado sensível)
          "update.phone", "update.email", "update.cpf",
          "update.height", "update.bust", "update.waist", "update.hips",
          // Códigos de pagamento (podem conter dados do pagador)
          "pixCopiaCola", "*.pixCopiaCola", "pixQrCode", "*.pixQrCode", "paymentLink", "boletoLine",
          // Payloads crus de webhook (Meta/Mercado Pago) carregam telefone/dados do cliente
          "body", "*.body",
        ],
      },
      transport: process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
        : undefined,
    },
  });

  app.register(healthRoutes,       { prefix: "/health" });
  app.register(conversationRoutes, { prefix: "/conversations" });
  app.register(catalogRoutes,      { prefix: "/catalog" });
  app.register(catalogEnrichmentRoutes, { prefix: "/catalog" });
  app.register(adminRoutes,        { prefix: "/admin" });
  app.register(inboxRoutes,        { prefix: "/inbox" });
  app.register(metricsRoutes,      { prefix: "/metrics" });
  app.register(postSaleRoutes,     { prefix: "/post-sale" });
  app.register(orderRoutes,        { prefix: "/orders" });
  app.register(purchasingRoutes,   { prefix: "/purchasing" });
  app.register(lgpdRoutes,         { prefix: "/lgpd" });
  app.register(webhookRoutes,      { prefix: "/webhooks" });

  return app;
}
