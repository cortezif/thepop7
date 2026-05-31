import { runAgentTurn, summarizeConversation, extractProductAttributes, DEFAULT_CASCADE, PRODUCTION_TOOL_DEFS, type AgentConfig, type ConversationContext, type AgentToolImpl } from "@hubadvisor/agent";
import { getTariff, quoteDelivery, courierQuoteForTenant } from "./delivery-service.js";
import { cashbackBalance, cashbackHintFor } from "./cashback-service.js";
import { getPrisma, withTenant, decryptPII, resolveTenantCredentials } from "@hubadvisor/db";
import { buildErpForTenant, getLogisticsConnector, getMessagingConnector } from "@hubadvisor/connectors";
import { resolveErpCreds } from "../lib/erp.js";
import { enterCredentials, type ContactProfileUpdate, type ProductSummary } from "@hubadvisor/shared";
import type { FastifyBaseLogger } from "fastify";
import { searchProducts, type CustomerProfile, type ProductFilter } from "./product-search.js";
import { createOrder, cancelOrder, startReturn, getOrderStatus } from "./order-service.js";
import { resolveContact } from "./identity-service.js";
import { enrichPoliciesWithMaps } from "../lib/store-pickup.js";
import { operationalTag } from "@hubadvisor/shared/customer-tags";
import { parseNpsScore, recordNps, npsReply, npsBand, pendingDetractorComment, attachNpsComment } from "./nps.js";

type IncomingDTO = {
  tenantSlug: string;
  channel:    "whatsapp" | "instagram" | "manual";
  contact:    { phone?: string; igHandle?: string; name?: string };
  text:       string;
  // Fotos enviadas pela cliente nesta mensagem (URLs acessíveis ao Claude vision).
  // Habilita a busca visual via tool buscar_por_foto.
  photoUrls?: string[];
};

export async function handleIncomingMessage(dto: IncomingDTO, log: FastifyBaseLogger) {
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { slug: dto.tenantSlug } });
  if (!tenant) throw new Error(`Tenant não encontrado: ${dto.tenantSlug}`);
  // Credenciais da loja no contexto: agent (Anthropic) e envio (WhatsApp/IG)
  // passam a usar a credencial desta loja; sem nada salvo, cai na env.
  enterCredentials(await resolveTenantCredentials(tenant.id));

  // FASE 1 (transação curta): garante contato, conversa, persiste a entrada
  // e carrega o contexto. NUNCA roda LLM aqui — transações Prisma têm timeout.
  const setup = await withTenant(tenant.id, async (tx) => {
    // Resolve o contato fundindo identidades cross-canal quando convergem (ADR-015).
    const contact = await resolveContact(tx, tenant.id, {
      phone:    dto.contact.phone,
      igHandle: dto.contact.igHandle,
      name:     dto.contact.name,
      preferredChannel: dto.channel === "manual" ? undefined : dto.channel,
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

    const hasPhotos = (dto.photoUrls?.length ?? 0) > 0;
    await tx.message.create({
      data: {
        conversationId: conversation.id,
        direction: "in",
        type: hasPhotos ? "image" : "text",
        content: dto.text?.trim()
          ? dto.text
          : (hasPhotos ? `[cliente enviou ${dto.photoUrls!.length} foto(s)]` : ""),
      },
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

  // Perfil/classificação (ADR-036): gates operacionais ANTES de qualquer IA.
  const gate = operationalTag(contact.tags);
  if (gate === "block") {
    // Cliente banido → não atende; parqueia pra humano, sem resposta automática.
    await withTenant(tenant.id, (tx) => tx.conversation.update({
      where: { id: conversation.id }, data: { status: "handed_off", handoffReason: "Cliente banido (perfil)" },
    }));
    log.warn({ conversationId: conversation.id, contactId: contact.id }, "perfil: cliente banido — sem atendimento");
    return { conversationId: conversation.id, reply: null, toolCalls: [], cost: null, blocked: true };
  }
  if (gate === "human") {
    // Cliente que exige atendimento humano → encaminha já, com aviso gentil.
    const reply = "Oi! Vou te encaminhar para uma pessoa do nosso time, tá? Já já alguém te responde por aqui 💛";
    await withTenant(tenant.id, async (tx) => {
      await tx.message.create({ data: { conversationId: conversation.id, direction: "out", type: "text", content: reply } });
      await tx.conversation.update({ where: { id: conversation.id }, data: { status: "handed_off", handoffReason: "Atendimento humano (perfil do cliente)", lastMessageAt: new Date() } });
    });
    log.info({ conversationId: conversation.id, contactId: contact.id }, "perfil: requer atendimento humano — encaminhado");
    return { conversationId: conversation.id, reply, toolCalls: [], cost: null, handoff: true };
  }

  // Captura de NPS (ADR-017): nota 0-10 após marco D+14/D+30 recente (≤7d) → registra
  // e agradece, sem acionar o agente (não gasta IA).
  const npsScore = parseNpsScore(dto.text);

  // Captura do COMENTÁRIO de detrator: se há um NPS de detrator recente sem
  // comentário e esta mensagem NÃO é uma nota, trata-a como a justificativa. A
  // conversa já está em handoff (escalada no recebimento da nota baixa) — só
  // registra e confirma; o humano cuida da recuperação.
  if (npsScore == null && dto.text.trim().length > 1) {
    const pending = await pendingDetractorComment(tenant.id, contact.id);
    if (pending) {
      await attachNpsComment(tenant.id, pending.id, dto.text.trim());
      const ack = "Muito obrigada por compartilhar 💛 Já passei seu retorno pra nossa equipe dar uma olhada com carinho — em breve a gente te procura.";
      await withTenant(tenant.id, async (tx) => {
        await tx.message.create({ data: { conversationId: conversation.id, direction: "out", type: "text", content: ack } });
        await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
      });
      log.info({ npsId: pending.id }, "NPS: comentário de detrator capturado (ADR-017)");
      return { conversationId: conversation.id, reply: ack, toolCalls: [], cost: null };
    }
  }

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
      const reply = npsReply(npsScore);
      const isDetractor = npsBand(npsScore) === "detrator";
      await withTenant(tenant.id, async (tx) => {
        await tx.message.create({ data: { conversationId: conversation.id, direction: "out", type: "text", content: reply } });
        const data: Record<string, unknown> = { lastMessageAt: new Date() };
        // Detrator → escala pra humano recuperar o cliente (e captura o motivo na próxima msg).
        if (isDetractor) { data.status = "handed_off"; data.handoffReason = `NPS detrator: nota ${npsScore}`; }
        await tx.conversation.update({ where: { id: conversation.id }, data });
      });
      log.info({ score: npsScore, orderId: npsOrderId, detractor: isDetractor }, "NPS capturado (ADR-017)");
      return { conversationId: conversation.id, reply, toolCalls: [], cost: null, npsCaptured: npsScore, handoff: isDetractor || undefined };
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
    cashback: tenant.cashbackEnabled ? (await cashbackHintFor(tenant.id, contact.id)) ?? undefined : undefined,
    contactTags: contact.tags ?? [],
  };

  const cfg: AgentConfig = {
    tenantId:  tenant.id,
    persona:   tenant.agentPersona,
    tone:      tenant.agentTone ?? "",
    policies:  enrichPoliciesWithMaps(tenant.policies as Record<string, unknown>),
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
  }, { autoApproveMaxBRL: Number(tenant.autoApproveMaxBRL), photoUrls: dto.photoUrls, erpCreds: await resolveErpCreds(tenant.id), segment: tenant.segment, vocab: (tenant.catalogVocab as any) ?? undefined, productionEnabled: tenant.productionEnabled, storeZip: (tenant.policies as any)?.storeZip });

  // Se a cliente mandou foto, avisa o agente p/ chamar a busca visual (ele é text-only).
  let agentMessage = dto.text ?? "";
  if ((dto.photoUrls?.length ?? 0) > 0) {
    const note = `[A cliente enviou ${dto.photoUrls!.length} foto(s) de uma peça de roupa nesta mensagem. ` +
      `Use a tool buscar_por_foto para analisar a imagem e encontrar produtos parecidos no nosso catálogo, depois apresente as opções de forma natural.]`;
    agentMessage = agentMessage.trim() ? `${agentMessage}\n\n${note}` : note;
  }
  const turn = await runAgentTurn(cfg, ctx, agentMessage, tools, cascadeOverride, tenant.productionEnabled ? PRODUCTION_TOOL_DEFS : []);

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

  // FASE 4: entrega a resposta no canal real (WhatsApp / Instagram).
  // Só para canais externos; "manual" é simulação no painel.
  // Falha de envio é não-fatal: a resposta já está no DB.
  if (turn.replyText && dto.channel !== "manual") {
    try {
      const phone = decryptPII(contact.phone);
      const igHandle = contact.igHandle;
      const to = dto.channel === "instagram" ? igHandle : phone;
      if (to) {
        await getMessagingConnector(dto.channel).send({
          tenantId: tenant.id,
          conversationId: conversation.id,
          type: "text",
          text: turn.replyText,
          to: to ?? undefined,
          channel: dto.channel,
        });
      }
    } catch (e) {
      log.warn({ error: String(e), channel: dto.channel }, "messaging.send falhou — não-fatal");
    }
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
  enterCredentials(await resolveTenantCredentials(tenant.id));

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
    cashback: contact && tenant.cashbackEnabled ? (await cashbackHintFor(tenant.id, contact.id)) ?? undefined : undefined,
    contactTags: contact?.tags ?? [],
  };

  const cfg: AgentConfig = {
    tenantId: tenant.id,
    persona: tenant.agentPersona,
    tone: tenant.agentTone ?? "",
    policies: enrichPoliciesWithMaps(tenant.policies as Record<string, unknown>),
    storeName: tenant.name,
  };

  const tools = buildAgentTools(tenant.id, contact?.id ?? "", conversationId, log, {
    styles: contact?.styles ?? [],
    occasions: contact?.occasions ?? [],
    avoid: contact?.avoid ?? [],
    usualSize: contact?.usualSize ?? undefined,
    favoriteColors: contact?.favoriteColors ?? [],
  }, { readOnly: true, erpCreds: await resolveErpCreds(tenant.id), segment: tenant.segment, vocab: (tenant.catalogVocab as any) ?? undefined, productionEnabled: tenant.productionEnabled, storeZip: (tenant.policies as any)?.storeZip });

  const turn = await runAgentTurn(cfg, ctx, userMessage, tools, undefined, tenant.productionEnabled ? PRODUCTION_TOOL_DEFS : []);
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
function buildAgentTools(tenantId: string, contactId: string, conversationId: string, log: FastifyBaseLogger, customerProfile: CustomerProfile = {}, opts: { readOnly?: boolean; autoApproveMaxBRL?: number; photoUrls?: string[]; erpCreds?: { trayCreds: { apiUrl: string; accessToken: string } | null; blingCreds: { accessToken: string } | null; omieCreds?: { appKey: string; appSecret: string } | null; vhsysCreds?: { accessToken: string; secretToken: string } | null }; segment?: string; vocab?: { styles?: string[]; occasions?: string[] }; productionEnabled?: boolean; storeZip?: string } = {}): AgentToolImpl {
  const erp       = buildErpForTenant({ trayCreds: opts.erpCreds?.trayCreds ?? null, blingCreds: opts.erpCreds?.blingCreds ?? null, omieCreds: opts.erpCreds?.omieCreds ?? null, vhsysCreds: opts.erpCreds?.vhsysCreds ?? null });
  const logistics = getLogisticsConnector();
  const prisma    = getPrisma();
  const readOnly  = opts.readOnly ?? false;
  const autoApproveMaxBRL = opts.autoApproveMaxBRL;
  const photoUrls = opts.photoUrls ?? [];
  const segment   = opts.segment;
  const vocab     = opts.vocab;
  const productionEnabled = opts.productionEnabled ?? false;

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
        measurements: h.measurements,
      }));
      log.info({ query, count: results.length, reason: hits[0]?.matchReason }, "tool:buscar_produto");
      return results;
    },

    async buscarPorFoto(o = {}) {
      if (photoUrls.length === 0) {
        return { produtos: [], erro: "Nenhuma foto foi enviada pela cliente nesta mensagem." };
      }
      // 1. Claude vision "lê" a peça da foto -> atributos estruturados (reusa o extractor do catálogo).
      const extraction = await extractProductAttributes({
        productName: "item enviado pela cliente",
        photoUrls,
        segment,
        vocab,
      });
      if (!extraction.ok) {
        log.warn({ error: extraction.error }, "tool:buscar_por_foto — extração falhou");
        return { produtos: [], erro: `Não consegui analisar a foto: ${extraction.error}` };
      }
      const a = extraction.attributes;

      // 2. Monta intent textual + filtros leves p/ a busca semântica/atributos existente.
      //    NÃO impõe semDecote/semTransparencia como filtro duro: queremos PARECIDOS,
      //    não excluir — estilo/ocasião já direcionam o ranqueamento por similaridade.
      const intent = [
        ...a.styles,
        ...a.occasions,
        `decote ${a.neckline}`,
        `comprimento ${a.length}`,
        `manga ${a.sleeveType}`,
        a.sheer ? "transparência" : "",
      ].filter(Boolean).join(" ");
      const filters: ProductFilter = {
        estilo: a.styles,
        ocasiao: a.occasions,
        ...(o.precoMax ? { precoMax: o.precoMax } : {}),
        ...(o.tamanho ? { tamanho: o.tamanho } : {}),
      };

      const hits = await searchProducts(tenantId, intent, filters, 5, customerProfile);
      const produtos: ProductSummary[] = hits.map((h) => ({
        id: h.externalId,
        name: h.name,
        priceBRL: h.priceBRL,
        variants: h.variants,
        mainPhoto: h.mainPhoto,
        styles: h.styles,
        occasions: h.occasions,
        measurements: h.measurements,
      }));
      log.info({ atributos: a, count: produtos.length }, "tool:buscar_por_foto");
      return {
        atributosDetectados: {
          styles: a.styles, occasions: a.occasions, neckline: a.neckline,
          length: a.length, sleeveType: a.sleeveType, sheer: a.sheer, confidence: a.confidence,
        },
        produtos,
      };
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
      let orderVol = 0; // volume do pedido p/ entrega própria (ADR-030)
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
        orderVol += (it.quantidade ?? 1) * (dbProduct.deliveryVolume ?? 1);
      }

      // Frete: retirada na loja, entrega própria (motoboy/carro), entregador on-demand
      // ou transportadora (Melhor Envio).
      let shipBRL = 0;
      let shipCarrier: string | undefined;
      // Retirada na loja (ADR-034): sem frete; não precisa de CEP.
      const retira = !!input.retiradaNaLoja;
      const shippingZip = retira ? (input.cep || opts.storeZip || "00000000") : (input.cep ?? "");
      if (!retira && !input.cep) {
        return { error: "Para entrega preciso do CEP. Se a cliente prefere retirar na loja, refaça com retiradaNaLoja=true." } as any;
      }
      if (retira) {
        shipBRL = 0;
        shipCarrier = "Retirada na loja";
      } else if (input.entregaPropria) {
        const tariff = await getTariff(tenantId);
        if (!tariff.configured) {
          return { error: "Entrega própria não está configurada nesta loja. Refaça o pedido com frete de transportadora (sem entregaPropria)." } as any;
        }
        if (input.distanciaKm == null) {
          return { error: "Para entrega própria, informe a distância (distanciaKm) até a cliente. Pergunte o bairro/distância antes de fechar." } as any;
        }
        const q = quoteDelivery({ distanceKm: input.distanciaKm, volume: orderVol, tariff });
        shipBRL = q.priceBRL;
        shipCarrier = `Entrega própria (${q.modal})`;
      } else if (input.entregadorOnDemand) {
        // Entregador sob demanda: geocoda os CEPs e cota; modal automático por volume.
        const fromCep = opts.storeZip ?? process.env.STORE_DEFAULT_ZIP ?? "01310-100";
        const tariff = await getTariff(tenantId);
        const modal = orderVol <= tariff.motoVolumeLimit ? "moto" : "carro";
        const itemsValueBRL = items.reduce((s, i) => s + i.unitPriceBRL * i.quantity, 0);
        const cq = await courierQuoteForTenant(tenantId, { fromCep, toCep: shippingZip, modal, itemsValueBRL });
        if (!cq.ok) {
          log.warn({ reason: cq.reason }, "tool:criar_pedido — cotação de entregador falhou");
          return { error: `Não consegui cotar o entregador (${cq.reason}). Ofereça outra forma de entrega (própria ou transportadora).` } as any;
        }
        shipBRL = cq.priceBRL;
        shipCarrier = `Entregador ${cq.modal}${cq.mock ? " (simulado)" : ` (${cq.provider})`}`;
      } else {
        const quotes = await logistics.quote({
          fromZip: "01310-100", toZip: shippingZip,
          items: [{ weightG: 500, widthCm: 30, heightCm: 5, lengthCm: 30, valueBRL: 200 }],
        });
        const chosen = input.servicoFrete
          ? quotes.find((q) => `${q.carrier} ${q.service}` === input.servicoFrete) ?? quotes[0]
          : quotes[0];
        shipBRL = chosen?.priceBRL ?? 0;
        shipCarrier = chosen ? `${chosen.carrier} ${chosen.service}` : undefined;
      }

      // Auto-aprovação (ADR-025): pedido acima do limite não fecha sozinho —
      // parqueia pra confirmação humana antes de gerar o PIX.
      const subtotal = items.reduce((s, i) => s + i.unitPriceBRL * i.quantity, 0);
      const total = subtotal + shipBRL;
      if (autoApproveMaxBRL != null && total > autoApproveMaxBRL) {
        // Cria o pedido como PENDENTE (sem PIX) e parqueia pra aprovação humana.
        const pending = await createOrder({
          tenantId, contactId, items,
          shippingZip,
          shippingBRL: shipBRL,
          carrier: shipCarrier,
          pendingApproval: true,
          desiredDate: input.dataDesejada,
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
        shippingZip,
        shippingBRL: shipBRL,
        carrier: shipCarrier,
        desiredDate: input.dataDesejada,
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

    async consultarCashback() {
      const saldoBRL = await cashbackBalance(tenantId, contactId);
      log.info({ saldoBRL }, "tool:consultar_cashback");
      return { saldoBRL };
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

    // ── Fabricação (ADR-030 — Fase 4). Só fazem sentido em lojas que fabricam. ──
    async consultarFicha(sku) {
      // Acha o produto dono do SKU (variante) e a ficha técnica vinculada.
      const products = await prisma.product.findMany({ where: { tenantId, active: true } });
      const product = products.find((p) => ((p.variants as Array<{ sku: string }>) ?? []).some((v) => v.sku === sku));
      if (!product) return { produto: "", sobEncomenda: false, prazoDias: null, ingredientes: [], semFicha: true, erro: `SKU não encontrado: ${sku}` };

      const bom = await prisma.billOfMaterials.findFirst({
        where: { tenantId, active: true, productId: product.id, OR: [{ variantSku: sku }, { variantSku: null }] },
        include: { items: { include: { material: true } } },
        orderBy: { variantSku: "desc" }, // prefere a ficha específica da variante
      });
      const ingredientes = bom
        ? bom.items.filter((i) => i.material.category === "ingrediente").map((i) => i.material.name)
        : [];
      log.info({ sku, hasBom: !!bom }, "tool:consultar_ficha");
      return {
        produto: product.name,
        sobEncomenda: product.madeToOrder,
        prazoDias: product.leadTimeDays ?? null,
        ingredientes,
        semFicha: !bom,
        observacao: bom ? undefined : "Sem ficha técnica cadastrada — não afirme ingredientes que você não tem.",
      };
    },

    async calcularEntregaPropria(input = {}) {
      const tariff = await getTariff(tenantId);
      if (!tariff.configured) {
        return { disponivel: false, observacao: "Entrega própria não configurada. Use consultar_frete (transportadora)." };
      }
      // Volume do pedido = Σ (quantidade × volume do produto).
      let volume = 0;
      if (input.itens?.length) {
        const products = await prisma.product.findMany({ where: { tenantId } });
        for (const it of input.itens) {
          const p = products.find((pp) => ((pp.variants as Array<{ sku: string }>) ?? []).some((v) => v.sku === it.sku));
          volume += (it.quantidade ?? 1) * (p?.deliveryVolume ?? 1);
        }
      }
      const modalSugerido = volume <= tariff.motoVolumeLimit ? "moto" : "carro";
      if (input.distanceKm == null) {
        log.info({ volume, modalSugerido }, "tool:calcular_entrega_propria (sem distância)");
        return {
          disponivel: true, precisaDistancia: true, volume, modalSugerido,
          faixas: tariff.bands,
          observacao: "Pergunte o bairro/distância aproximada (km) da cliente para informar o valor exato.",
        };
      }
      const q = quoteDelivery({ distanceKm: input.distanceKm, volume, tariff });
      log.info({ distanceKm: input.distanceKm, volume, modal: q.modal, price: q.priceBRL }, "tool:calcular_entrega_propria");
      return {
        disponivel: true, modal: q.modal, precoBRL: q.priceBRL,
        distanceKm: q.distanceKm, volume, foraDeFaixa: q.outOfRange,
        ...(q.noTariff ? { observacao: "Sem faixa para esse modal — confirme com um atendente." } : {}),
      };
    },
  };
}
