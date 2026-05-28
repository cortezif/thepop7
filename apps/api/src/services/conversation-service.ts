import { runAgentTurn, summarizeConversation, DEFAULT_CASCADE, type AgentConfig, type ConversationContext, type AgentToolImpl } from "@thepop/agent";
import { getPrisma, withTenant } from "@thepop/db";
import { getErpConnector, getLogisticsConnector } from "@thepop/connectors";
import type { ContactProfileUpdate, ProductSummary } from "@thepop/shared";
import type { FastifyBaseLogger } from "fastify";
import { searchProducts, type CustomerProfile } from "./product-search.js";
import { createOrder, cancelOrder, startReturn, getOrderStatus } from "./order-service.js";
import { resolveContact } from "./identity-service.js";
import { parseNpsScore, recordNps } from "./nps.js";

type IncomingDTO = {
  tenantSlug: string;
  channel:    "whatsapp" | "instagram" | "manual";
  contact:    { phone?: string; igHandle?: string; name?: string };
  text:       string;
};

export async function handleIncomingMessage(dto: IncomingDTO, log: FastifyBaseLogger) {
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { slug: dto.tenantSlug } });
  if (!tenant) throw new Error(`Tenant não encontrado: ${dto.tenantSlug}`);

  // FASE 1 (transação curta): garante contato, conversa, persiste a entrada
  // e carrega o contexto. NUNCA roda LLM aqui — transações Prisma têm timeout.
  const setup = await withTenant(tenant.id, async (tx) => {
    // Resolve o contato fundindo identidades cross-canal quando convergem (ADR-015).
    const contact = await resolveContact(tx, tenant.id, {
      phone:    dto.contact.phone,
      igHandle: dto.contact.igHandle,
      name:     dto.contact.name,
    });

    let conversation = await tx.conversation.findFirst({
      where: { tenantId: tenant.id, contactId: contact.id, status: "active" },
      orderBy: { startedAt: "desc" },
    });
    if (!conversation) {
      conversation = await tx.conversation.create({
        data: { tenantId: tenant.id, contactId: contact.id, channel: dto.channel },
      });
    }

    await tx.message.create({
      data: { conversationId: conversation.id, direction: "in", type: "text", content: dto.text },
    });
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    const recent = await tx.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      take: 12,
    });

    // Memória de longo prazo (ADR-007): resumos de conversas ANTERIORES desta cliente.
    const priorConvs = await tx.conversation.findMany({
      where: { contactId: contact.id, id: { not: conversation.id }, summary: { not: null } },
      orderBy: { lastMessageAt: "desc" },
      take: 3,
      select: { summary: true },
    });

    // Custo de IA do mês (ADR-014: degradação graceful ao estourar orçamento).
    const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
    const spend = await tx.message.aggregate({
      where: { direction: "out", llmModel: { not: null }, createdAt: { gte: startOfMonth } },
      _sum: { llmCostBRL: true },
    });

    return {
      contact, conversation, recent,
      priorSummaries: priorConvs.map((c) => c.summary!).filter(Boolean),
      monthSpendBRL: Number(spend._sum.llmCostBRL ?? 0),
    };
  });

  const { contact, conversation, recent, priorSummaries, monthSpendBRL } = setup;

  // Captura de NPS (ADR-017): nota 0-10 após marco D+14/D+30 recente (≤7d) → registra
  // e agradece, sem acionar o agente (não gasta IA).
  const npsScore = parseNpsScore(dto.text);
  if (npsScore != null) {
    const npsOrderId = await withTenant(tenant.id, async (tx) => {
      const orders = await tx.order.findMany({ where: { contactId: contact.id }, select: { id: true } });
      const orderIds = orders.map((o) => o.id);
      if (!orderIds.length) return null;
      const prompt = await tx.domainEvent.findFirst({
        where: {
          tenantId: tenant.id, aggregateType: "order", aggregateId: { in: orderIds },
          type: { in: ["postsale.d14", "postsale.d30"] },
          createdAt: { gte: new Date(Date.now() - 7 * 864e5) },
        },
        orderBy: { createdAt: "desc" },
      });
      return prompt?.aggregateId ?? null;
    });
    if (npsOrderId) {
      await recordNps(tenant.id, { contactId: contact.id, orderId: npsOrderId, kind: "produto", score: npsScore });
      const thanks = `Obrigada pela nota ${npsScore}! 💛 Seu feedback ajuda muito a gente a melhorar.`;
      await withTenant(tenant.id, async (tx) => {
        await tx.message.create({ data: { conversationId: conversation.id, direction: "out", type: "text", content: thanks } });
        await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
      });
      log.info({ score: npsScore, orderId: npsOrderId }, "NPS capturado (ADR-017)");
      return { conversationId: conversation.id, reply: thanks, toolCalls: [], cost: null, npsCaptured: npsScore };
    }
  }

  // Orçamento estourado → degrada o modelo (pula o Sonnet, começa no Haiku). ADR-014/025.
  const overBudget = monthSpendBRL >= Number(tenant.monthlyAIBudgetBRL);
  const cascadeOverride = overBudget ? DEFAULT_CASCADE.filter((m) => m.model !== "claude-sonnet-4-6") : undefined;
  if (overBudget) log.warn({ monthSpendBRL, budget: Number(tenant.monthlyAIBudgetBRL) }, "orçamento estourado — degradando p/ Haiku");

  // Kill-switch (ADR-025): IA pausada → não responde, parqueia pra humano.
  if (!tenant.aiEnabled) {
    await withTenant(tenant.id, async (tx) => {
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { status: "handed_off", handoffReason: "IA pausada (kill-switch)" },
      });
    });
    log.warn({ conversationId: conversation.id }, "kill-switch ativo: mensagem parqueada pra humano");
    return { conversationId: conversation.id, reply: null, toolCalls: [], cost: null, aiPaused: true };
  }

  const ctx: ConversationContext = {
    conversationId: conversation.id,
    contactId:      contact.id,
    channel:        dto.channel,
    contactProfile: {
      name:           contact.name ?? undefined,
      height:         contact.height ?? undefined,
      bust:           contact.bust ?? undefined,
      waist:          contact.waist ?? undefined,
      hips:           contact.hips ?? undefined,
      usualSize:      contact.usualSize ?? undefined,
      styles:         contact.styles,
      occasions:      contact.occasions,
      avoid:          contact.avoid,
      favoriteColors: contact.favoriteColors,
    },
    recentMessages: recent.reverse().slice(0, -1).map((m) => ({
      direction: m.direction,
      text: m.content ?? "",
    })),
    priorSummaries,
  };

  const cfg: AgentConfig = {
    tenantId:  tenant.id,
    persona:   tenant.agentPersona,
    tone:      tenant.agentTone ?? "",
    policies:  (tenant.policies as Record<string, unknown>) ?? {},
    storeName: tenant.name,
  };

  // FASE 2 (FORA de transação): roda o agente. Pode levar segundos (LLM + tools).
  // As tools fazem suas próprias transações curtas quando precisam escrever.
  const tools = buildAgentTools(tenant.id, contact.id, conversation.id, log, {
    styles: contact.styles,
    occasions: contact.occasions,
    avoid: contact.avoid,
    usualSize: contact.usualSize ?? undefined,
    favoriteColors: contact.favoriteColors,
  }, { autoApproveMaxBRL: Number(tenant.autoApproveMaxBRL) });
  const turn = await runAgentTurn(cfg, ctx, dto.text, tools, cascadeOverride);

  // FASE 3 (transação curta): persiste a resposta.
  if (turn.replyText) {
    await withTenant(tenant.id, async (tx) => {
      await tx.message.create({
        data: {
          conversationId: conversation.id,
          direction:      "out",
          type:           "text",
          content:        turn.replyText,
          llmModel:       turn.llmUsage.model,
          llmInputTokens: turn.llmUsage.inputTokens,
          llmOutputTokens: turn.llmUsage.outputTokens,
          llmCachedTokens: turn.llmUsage.cachedTokens,
          llmCostBRL:     turn.llmUsage.estimatedCostBRL,
          toolCalls:      turn.toolCalls as any,
          reviewFlagged:  turn.review?.flagged ?? false,
          reviewReasons:  turn.review?.reasons ?? [],
        },
      });
    });
  }

  return {
    conversationId: conversation.id,
    reply: turn.replyText,
    toolCalls: turn.toolCalls,
    cost: turn.llmUsage,
  };
}

/**
 * Gera e persiste o resumo de uma conversa (ADR-007) pra virar memória da
 * cliente na próxima vez. Idempotente o suficiente: sobrescreve o summary.
 * Não roda LLM dentro de transação — gera fora e grava num update curto.
 */
export async function summarizeAndPersist(tenantSlug: string, conversationId: string, log: FastifyBaseLogger) {
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) throw new Error(`Tenant não encontrado: ${tenantSlug}`);

  const messages = await withTenant(tenant.id, async (tx) => {
    return tx.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      select: { direction: true, content: true },
    });
  });

  const summary = await summarizeConversation({
    storeName: tenant.name,
    persona: tenant.agentPersona,
    messages: messages.map((m) => ({ direction: m.direction, text: m.content ?? "" })),
  });

  await withTenant(tenant.id, async (tx) => {
    await tx.conversation.update({ where: { id: conversationId }, data: { summary } });
  });
  log.info({ conversationId, len: summary.length }, "conversa resumida (ADR-007)");
  return { summary };
}

/**
 * Co-piloto do atendente (ADR-016): roda a Maya em modo READ-ONLY pra
 * SUGERIR uma resposta na conversa em handoff — sem persistir mensagem,
 * sem mutar perfil/estoque/pedido. O atendente revisa e envia.
 */
export async function suggestReply(tenantSlug: string, conversationId: string, log: FastifyBaseLogger) {
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) throw new Error(`Tenant não encontrado: ${tenantSlug}`);

  const data = await withTenant(tenant.id, async (tx) => {
    const conversation = await tx.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new Error("conversa não encontrada");
    const contact = conversation.contactId
      ? await tx.contact.findUnique({ where: { id: conversation.contactId } })
      : null;
    const recent = await tx.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: 12,
    });
    return { conversation, contact, recent: recent.reverse() };
  });

  const { conversation, contact, recent } = data;

  // A mensagem a responder = última entrada da cliente. Histórico = tudo antes dela.
  const lastInIdx = [...recent].reverse().findIndex((m) => m.direction === "in");
  const lastInPos = lastInIdx === -1 ? -1 : recent.length - 1 - lastInIdx;
  const userMessage = lastInPos === -1 ? "" : recent[lastInPos]!.content ?? "";
  const history = (lastInPos === -1 ? recent : recent.slice(0, lastInPos)).map((m) => ({
    direction: m.direction,
    text: m.content ?? "",
  }));

  if (!userMessage) {
    return { suggestion: "", toolCalls: [], cost: null, note: "Sem mensagem da cliente para responder." };
  }

  const ctx: ConversationContext = {
    conversationId,
    contactId: contact?.id,
    channel: conversation.channel as ConversationContext["channel"],
    contactProfile: {
      name: contact?.name ?? undefined,
      height: contact?.height ?? undefined,
      bust: contact?.bust ?? undefined,
      waist: contact?.waist ?? undefined,
      hips: contact?.hips ?? undefined,
      usualSize: contact?.usualSize ?? undefined,
      styles: contact?.styles ?? [],
      occasions: contact?.occasions ?? [],
      avoid: contact?.avoid ?? [],
      favoriteColors: contact?.favoriteColors ?? [],
    },
    recentMessages: history,
  };

  const cfg: AgentConfig = {
    tenantId: tenant.id,
    persona: tenant.agentPersona,
    tone: tenant.agentTone ?? "",
    policies: (tenant.policies as Record<string, unknown>) ?? {},
    storeName: tenant.name,
  };

  const tools = buildAgentTools(tenant.id, contact?.id ?? "", conversationId, log, {
    styles: contact?.styles ?? [],
    occasions: contact?.occasions ?? [],
    avoid: contact?.avoid ?? [],
    usualSize: contact?.usualSize ?? undefined,
    favoriteColors: contact?.favoriteColors ?? [],
  }, { readOnly: true });

  const turn = await runAgentTurn(cfg, ctx, userMessage, tools);
  return {
    suggestion: turn.replyText ?? "",
    toolCalls: turn.toolCalls,
    cost: turn.llmUsage,
    repliedTo: userMessage,
  };
}

/**
 * Implementação concreta das tools que o agente pode invocar.
 * Tudo o que o agente "decide fazer" passa por aqui — então este é o
 * lugar pra colocar guardrails (limites, regras de negócio, auditoria).
 */
function buildAgentTools(tenantId: string, contactId: string, conversationId: string, log: FastifyBaseLogger, customerProfile: CustomerProfile = {}, opts: { readOnly?: boolean; autoApproveMaxBRL?: number } = {}): AgentToolImpl {
  const erp       = getErpConnector();
  const logistics = getLogisticsConnector();
  const prisma    = getPrisma();
  const readOnly  = opts.readOnly ?? false;
  const autoApproveMaxBRL = opts.autoApproveMaxBRL;

  return {
    async buscarProduto(query) {
      // Constrói uma intent textual a partir dos filtros (vira input do
      // embedding de query quando Voyage está configurado).
      const intent = [
        ...(query.estilo ?? []),
        ...(query.ocasiao ?? []),
        ...(query.cores ?? []),
        query.tamanho,
      ].filter(Boolean).join(" ");

      const hits = await searchProducts(tenantId, intent || null, query, 5, customerProfile);
      const results: ProductSummary[] = hits.map((h) => ({
        id: h.externalId,
        name: h.name,
        priceBRL: h.priceBRL,
        variants: h.variants,
        mainPhoto: h.mainPhoto,
        styles: h.styles,
        occasions: h.occasions,
      }));
      log.info({ query, count: results.length, reason: hits[0]?.matchReason }, "tool:buscar_produto");
      return results;
    },

    async mostrarMidia(produtoId, tipo = "foto") {
      // No MVP, devolve apenas confirmação. A integração real envia mídia
      // via canal (WhatsApp/Instagram) — vai aqui na Fase 1.2.
      log.info({ produtoId, tipo }, "tool:mostrar_midia");
      return { enviado: true, descricao: `Mídia (${tipo}) do produto ${produtoId} enviada.` };
    },

    async verificarEstoque(sku) {
      const disponivel = await erp.getStock(sku);
      const reservado = await prisma.stockReservation.count({
        where: { tenantId, status: "active" },
      });
      log.info({ sku, disponivel, reservado }, "tool:verificar_estoque");
      return { disponivel, reservado };
    },

    async consultarFrete(cep, sku) {
      const quotes = await logistics.quote({
        fromZip: "01310-100",
        toZip: cep,
        items: [{ weightG: 500, widthCm: 30, heightCm: 5, lengthCm: 30, valueBRL: 200 }],
      });
      log.info({ cep, sku, count: quotes.length }, "tool:consultar_frete");
      return quotes.map((q) => ({ servico: `${q.carrier} ${q.service}`, precoBRL: q.priceBRL, prazoDias: q.deliveryDays }));
    },

    async atualizarPerfil(update: ContactProfileUpdate) {
      if (readOnly) { log.info({ update }, "tool:atualizar_perfil (read-only, ignorado)"); return; }
      await prisma.contact.update({ where: { id: contactId }, data: update });
      log.info({ update }, "tool:atualizar_perfil");
    },

    async reservarItem(sku, ttlMinutos = 15) {
      if (readOnly) {
        log.info({ sku }, "tool:reservar_item (read-only, simulado)");
        return { reservaId: "draft", expiraEm: new Date(Date.now() + ttlMinutos * 60_000).toISOString() };
      }
      // Localiza produto pelo SKU (no MVP, percorre catálogo do ERP)
      const products = await erp.listProducts();
      const product = products.find((p) => p.variants.some((v) => v.sku === sku));
      if (!product) throw new Error(`SKU não encontrado: ${sku}`);

      // Persiste reserva (o produto local deve existir; em produção há sync ERP→DB)
      const dbProduct = await prisma.product.findFirst({
        where: { tenantId, externalId: product.externalId },
      });
      if (!dbProduct) throw new Error(`Produto não sincronizado: ${product.externalId}`);

      const reservation = await prisma.stockReservation.create({
        data: {
          tenantId,
          productId: dbProduct.id,
          contactId,
          variantSku: sku,
          quantity: 1,
          expiresAt: new Date(Date.now() + ttlMinutos * 60_000),
        },
      });
      log.info({ sku, ttlMinutos }, "tool:reservar_item");
      return { reservaId: reservation.id, expiraEm: reservation.expiresAt.toISOString() };
    },

    async criarPedido(input) {
      if (readOnly) {
        // Sugestão não cria pedido: estima o total e devolve uma observação
        // pra Maya propor o fechamento — o atendente confirma e fecha de verdade.
        const products = await erp.listProducts();
        let subtotal = 0;
        for (const it of input.itens) {
          const product = products.find((p) => p.variants.some((v) => v.sku === it.sku));
          if (product) subtotal += product.priceBRL * (it.quantidade ?? 1);
        }
        log.info({ input }, "tool:criar_pedido (read-only, não persistido)");
        return {
          pedidoId: "",
          totalBRL: Number(subtotal.toFixed(2)),
          observacao: "Pedido NÃO criado (modo sugestão). Proponha fechar e confirme antes de gerar o PIX.",
        } as any;
      }
      // Resolve SKUs → produtos + preço; calcula frete
      const products = await erp.listProducts();
      const items: Array<{ productId: string; variantSku: string; quantity: number; unitPriceBRL: number }> = [];
      for (const it of input.itens) {
        const product = products.find((p) => p.variants.some((v) => v.sku === it.sku));
        if (!product) {
          // Não cria pedido fantasma: devolve erro explícito pra Maya rebuscar o SKU.
          log.warn({ sku: it.sku }, "tool:criar_pedido — SKU não encontrado no ERP");
          return { error: `SKU não encontrado no catálogo: ${it.sku}. Rebusque o produto com buscar_produto pra pegar o SKU correto.` } as any;
        }
        const dbProduct = await prisma.product.findFirst({ where: { tenantId, externalId: product.externalId } });
        if (!dbProduct) throw new Error(`Produto não sincronizado: ${product.externalId}`);
        items.push({ productId: dbProduct.id, variantSku: it.sku, quantity: it.quantidade ?? 1, unitPriceBRL: product.priceBRL });
      }

      const quotes = await logistics.quote({
        fromZip: "01310-100", toZip: input.cep,
        items: [{ weightG: 500, widthCm: 30, heightCm: 5, lengthCm: 30, valueBRL: 200 }],
      });
      const chosen = input.servicoFrete
        ? quotes.find((q) => `${q.carrier} ${q.service}` === input.servicoFrete) ?? quotes[0]
        : quotes[0];

      // Auto-aprovação (ADR-025): pedido acima do limite não fecha sozinho —
      // parqueia pra confirmação humana antes de gerar o PIX.
      const subtotal = items.reduce((s, i) => s + i.unitPriceBRL * i.quantity, 0);
      const total = subtotal + (chosen?.priceBRL ?? 0);
      if (autoApproveMaxBRL != null && total > autoApproveMaxBRL) {
        // Cria o pedido como PENDENTE (sem PIX) e parqueia pra aprovação humana.
        const pending = await createOrder({
          tenantId, contactId, items,
          shippingZip: input.cep,
          shippingBRL: chosen?.priceBRL ?? 0,
          carrier: chosen ? `${chosen.carrier} ${chosen.service}` : undefined,
          pendingApproval: true,
        });
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { status: "handed_off", handoffReason: `Pedido R$${total.toFixed(2)} acima do limite de auto-aprovação (R$${autoApproveMaxBRL.toFixed(2)})` },
        });
        log.warn({ total, limite: autoApproveMaxBRL, conversationId, pedidoId: pending.orderId }, "tool:criar_pedido pendente — precisa aprovação humana");
        return {
          pedidoId: pending.orderId,
          totalBRL: Number(total.toFixed(2)),
          needsApproval: true,
          observacao: `Este pedido (R$${total.toFixed(2)}) precisa de confirmação de um atendente antes de gerar o pagamento. NÃO gere PIX. Avise a cliente com gentileza que um atendente vai finalizar em instantes.`,
        } as any;
      }

      const result = await createOrder({
        tenantId, contactId, items,
        shippingZip: input.cep,
        shippingBRL: chosen?.priceBRL ?? 0,
        carrier: chosen ? `${chosen.carrier} ${chosen.service}` : undefined,
      });
      log.info({ orderId: result.orderId, total: result.totalBRL }, "tool:criar_pedido");
      return {
        pedidoId: result.orderId,
        totalBRL: result.totalBRL,
        pixCopiaCola: "pix" in result ? result.pix.qrCode : undefined,
        expiraEm: "pix" in result ? result.pix.expiresAt : undefined,
      };
    },

    async statusPedido(pedidoId) {
      const status = await getOrderStatus(tenantId, pedidoId);
      log.info({ pedidoId }, "tool:status_pedido");
      return status ?? { error: "pedido não encontrado" };
    },

    async cancelarPedido(pedidoId, motivo) {
      if (readOnly) { log.info({ pedidoId }, "tool:cancelar_pedido (read-only, simulado)"); return { ok: true }; }
      const r = await cancelOrder(tenantId, pedidoId, motivo);
      log.info({ pedidoId, ok: r.ok }, "tool:cancelar_pedido");
      return r;
    },

    async iniciarDevolucao(pedidoId, motivo) {
      if (readOnly) { log.info({ pedidoId }, "tool:iniciar_devolucao (read-only, simulado)"); return { ok: true, devolucaoId: "draft" }; }
      const r = await startReturn(tenantId, pedidoId, motivo);
      log.info({ pedidoId, ok: r.ok }, "tool:iniciar_devolucao");
      return r;
    },

    async escalarParaHumano(motivo) {
      if (readOnly) { log.info({ motivo }, "tool:escalar_para_humano (read-only, já em handoff)"); return { escalado: true }; }
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: "handed_off", handoffReason: motivo },
      });
      log.warn({ motivo, conversationId }, "tool:escalar_para_humano");
      return { escalado: true };
    },
  };
}
