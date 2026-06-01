import type { FastifyPluginAsync } from "fastify";
import { getPrisma, withTenant } from "@hubadvisor/db";
import { computeFinancials, computeFunnel } from "../services/order-service.js";
import { npsSummary, npsComments, npsTrend, npsList } from "../services/nps.js";

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  // GET /metrics/nps-comments?tenantSlug=... — comentários recentes (detratores/neutros).
  app.get("/nps-comments", async (req, reply) => {
    const tenant = await getPrisma().tenant.findUnique({ where: { slug: (req.query as any).tenantSlug as string } });
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    return npsComments(tenant.id);
  });

  // GET /metrics/nps?tenantSlug=...&band=detrator — painel dedicado de satisfação.
  app.get("/nps", async (req, reply) => {
    const q = req.query as any;
    const tenant = await getPrisma().tenant.findUnique({ where: { slug: q.tenantSlug as string } });
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    const band = ["promotor", "neutro", "detrator"].includes(q.band) ? q.band : undefined;
    const [summary, trend, list] = await Promise.all([
      npsSummary(tenant.id), npsTrend(tenant.id), npsList(tenant.id, { band }),
    ]);
    return { summary, trend, list };
  });

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
    const nps = await npsSummary(tenant.id);

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

      // Custo de mensageria WhatsApp (Meta) no mês — espelha o custo de IA.
      // "service" (dentro da janela de 24h) é grátis; o resto é template pago.
      const waMsgsMonth = await tx.message.findMany({
        where: { direction: "out", waCategory: { not: null }, createdAt: { gte: startOfMonth } },
        select: { waCostBRL: true, waCategory: true, createdAt: true },
      });
      const waCostMonthBRL = waMsgsMonth.reduce((s, m) => s + Number(m.waCostBRL ?? 0), 0);
      const waCostTodayBRL = waMsgsMonth
        .filter((m) => m.createdAt >= startOfDay)
        .reduce((s, m) => s + Number(m.waCostBRL ?? 0), 0);
      const waByCategory: Record<string, number> = {};
      let waPaidMsgsMonth = 0, waFreeMsgsMonth = 0;
      for (const m of waMsgsMonth) {
        const cat = m.waCategory ?? "?";
        waByCategory[cat] = (waByCategory[cat] ?? 0) + 1;
        if (cat === "service") waFreeMsgsMonth++; else waPaidMsgsMonth++;
      }
      const waCost = {
        costTodayBRL: Number(waCostTodayBRL.toFixed(4)),
        costMonthBRL: Number(waCostMonthBRL.toFixed(4)),
        paidMsgsMonth: waPaidMsgsMonth,
        freeMsgsMonth: waFreeMsgsMonth,
        byCategory: waByCategory,
      };

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

      // NF-e pendente: pedidos pagos (ou adiante) sem número de nota emitida.
      const nfePending = await tx.order.count({
        where: {
          status: { in: ["paid", "picking", "shipped", "in_transit", "out_for_delivery", "delivered", "finalized"] },
          nfeNumber: null,
        },
      });

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
        nfePending,
        financials,
        funnel,
        budget: monthBudget,
        waCost,
        nps,
      };
    });
  });
};
