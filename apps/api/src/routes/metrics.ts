import type { FastifyPluginAsync } from "fastify";
import { getPrisma, withTenant } from "@thepop/db";
import { computeFinancials, computeFunnel } from "../services/order-service.js";

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  // GET /metrics/daily?tenantSlug=...
  // Agrega métricas do dia corrente (e totais) pro painel.
  app.get("/daily", async (req, reply) => {
    const tenantSlug = (req.query as any).tenantSlug as string;
    const tenant = await getPrisma().tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const gatewayFees = ((tenant.policies as any)?.gatewayFees) as Record<string, number> | undefined;
    const financials = await computeFinancials(tenant.id, gatewayFees);
    const funnel = await computeFunnel(tenant.id);

    // Orçamento de IA do mês corrente (ADR-014/025)
    const monthBudget = await withTenant(tenant.id, async (tx) => {
      const msgs = await tx.message.findMany({
        where: { direction: "out", llmModel: { not: null }, createdAt: { gte: startOfMonth } },
        select: { llmCostBRL: true },
      });
      const monthCostBRL = msgs.reduce((s, m) => s + Number(m.llmCostBRL ?? 0), 0);
      const monthlyBudgetBRL = Number(tenant.monthlyAIBudgetBRL);
      const pctUsed = monthlyBudgetBRL > 0 ? (monthCostBRL / monthlyBudgetBRL) * 100 : 0;
      const level = pctUsed >= 100 ? "over" : pctUsed >= 80 ? "warning" : "ok";
      return {
        monthlyBudgetBRL,
        monthCostBRL: Number(monthCostBRL.toFixed(4)),
        pctUsed: Number(pctUsed.toFixed(1)),
        level,
      };
    });

    return withTenant(tenant.id, async (tx) => {
      // Conversas iniciadas hoje
      const conversationsToday = await tx.conversation.count({
        where: { startedAt: { gte: startOfDay } },
      });

      // Conversas ativas / handed_off
      const activeConversations = await tx.conversation.count({ where: { status: "active" } });
      const handedOff = await tx.conversation.count({ where: { status: "handed_off" } });
      const totalConversations = await tx.conversation.count();

      // Mensagens da IA hoje (com custo)
      const aiMessagesToday = await tx.message.findMany({
        where: { direction: "out", llmModel: { not: null }, createdAt: { gte: startOfDay } },
        select: { llmCostBRL: true, llmInputTokens: true, llmOutputTokens: true, llmModel: true },
      });

      // Mensagens flaggadas pra revisão (ADR-014: possível alucinação)
      const flaggedForReview = await tx.message.count({ where: { reviewFlagged: true } });

      const aiCostTodayBRL = aiMessagesToday.reduce((s, m) => s + Number(m.llmCostBRL ?? 0), 0);
      const aiMessagesCount = aiMessagesToday.length;

      // Custo total acumulado
      const allAiMessages = await tx.message.findMany({
        where: { direction: "out", llmModel: { not: null } },
        select: { llmCostBRL: true },
      });
      const aiCostTotalBRL = allAiMessages.reduce((s, m) => s + Number(m.llmCostBRL ?? 0), 0);

      // Distribuição de modelos (mostra o smart routing em ação)
      const modelDist: Record<string, number> = {};
      for (const m of aiMessagesToday) {
        const key = (m.llmModel ?? "?").replace("claude-", "").replace("-20251001", "");
        modelDist[key] = (modelDist[key] ?? 0) + 1;
      }

      // % resolvido por IA (conversas que NÃO precisaram de humano)
      const resolvedByAI = totalConversations > 0
        ? Math.round(((totalConversations - handedOff) / totalConversations) * 100)
        : 0;

      // Custo médio por conversa
      const avgCostPerConversation = totalConversations > 0
        ? aiCostTotalBRL / totalConversations
        : 0;

      // Catálogo
      const productsTotal = await tx.product.count();
      const productsEnriched = await tx.product.count({
        where: { enrichmentStatus: { in: ["ai_suggested", "approved"] } },
      });

      return {
        conversationsToday,
        activeConversations,
        handedOff,
        totalConversations,
        resolvedByAIPct: resolvedByAI,
        aiMessagesToday: aiMessagesCount,
        aiCostTodayBRL: Number(aiCostTodayBRL.toFixed(4)),
        aiCostTotalBRL: Number(aiCostTotalBRL.toFixed(4)),
        avgCostPerConversationBRL: Number(avgCostPerConversation.toFixed(4)),
        modelDistribution: modelDist,
        productsTotal,
        productsEnriched,
        flaggedForReview,
        financials,
        funnel,
        budget: monthBudget,
      };
    });
  });
};
