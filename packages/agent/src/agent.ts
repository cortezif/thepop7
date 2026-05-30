import Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig, ConversationContext, AgentToolImpl, AgentTurn } from "./types.js";
import { buildSystemPrompt } from "./prompt.js";
import { TOOL_DEFS } from "./tools.js";
import { cascadeCall, DEFAULT_CASCADE, type ProviderModel } from "./providers.js";
import { buildSmartCascade } from "./routing.js";
import { detectHallucination } from "./hallucination.js";

// Tabela aproximada de custos em BRL por 1M tokens (atualizar conforme pricing)
const PRICING_BRL_PER_MTOK: Record<string, { input: number; output: number; cached: number }> = {
  "claude-sonnet-4-6":            { input: 15, output: 75, cached: 1.5 },
  "claude-haiku-4-5-20251001":    { input: 4,  output: 20, cached: 0.4 },
  "llama-3.3-70b-versatile":      { input: 0,  output: 0,  cached: 0   }, // Groq free tier
  "llama3.1:8b":                  { input: 0,  output: 0,  cached: 0   }, // Ollama local
  "gemini-2.0-flash":             { input: 0.6, output: 2.4, cached: 0.15 }, // ~US$0.10/0.40 por Mtok
  "deepseek-chat":                { input: 1.5, output: 6,   cached: 0.4 },  // ~US$0.27/1.10 por Mtok
  "grok-2-1212":                  { input: 11,  output: 55,  cached: 0   },  // ~US$2/10 por Mtok
};

function estimateCostBRL(model: string, inputTokens: number, outputTokens: number, cachedTokens: number) {
  const p = PRICING_BRL_PER_MTOK[model] ?? PRICING_BRL_PER_MTOK["claude-sonnet-4-6"]!;
  // A Anthropic já reporta `input_tokens` como os tokens NÃO lidos do cache
  // (cache_read_input_tokens é contado à parte). Por isso NÃO se subtrai o
  // cache aqui — fazer isso dava custo negativo quando o cache era grande.
  const cost = (inputTokens * p.input + outputTokens * p.output + cachedTokens * p.cached) / 1_000_000;
  return Math.max(0, cost);
}

/**
 * Roda uma volta do agente: dada a mensagem da cliente + contexto,
 * decide o que fazer (chama tools quantas vezes precisar) e retorna
 * o texto de resposta a enviar de volta.
 *
 * Usa cascade de providers: tenta Claude → cai pra Haiku → Groq → Ollama
 * em caso de erro recuperável (rate limit, overload, timeout).
 */
export async function runAgentTurn(
  cfg: AgentConfig,
  ctx: ConversationContext,
  userMessage: string,
  tools: AgentToolImpl,
  cascade?: ProviderModel[],
  // Tools extras oferecidas só a este tenant (ex.: fabricação — ADR-030 Fase 4).
  extraToolDefs: Anthropic.Messages.Tool[] = []
): Promise<AgentTurn> {
  // Smart routing: escolhe a cascade ideal baseado em intent + tamanho.
  // Caller pode forçar uma cascade específica (ex.: testes).
  const effectiveCascade = cascade ?? buildSmartCascade({
    userMessage,
    turnsSoFar: ctx.recentMessages.length,
    hasRichProfile: !!(ctx.contactProfile.height || ctx.contactProfile.bust),
  });
  const { identity, tone, policies, contextBlock } = buildSystemPrompt(cfg, ctx);

  const systemBlocks = [
    { type: "text", text: identity, cache_control: { type: "ephemeral" } },
    { type: "text", text: tone,     cache_control: { type: "ephemeral" } },
    { type: "text", text: policies, cache_control: { type: "ephemeral" } },
    { type: "text", text: contextBlock },
  ] as unknown as Anthropic.Messages.MessageCreateParams["system"];

  const messages: Anthropic.Messages.MessageParam[] = [
    ...ctx.recentMessages.map(
      (m): Anthropic.Messages.MessageParam => ({
        role: m.direction === "in" ? "user" : "assistant",
        content: m.text,
      })
    ),
    { role: "user", content: userMessage },
  ];

  const toolCallsLog: AgentTurn["toolCalls"] = [];
  let totalIn = 0, totalOut = 0, totalCached = 0;
  let modelUsed = "unknown";
  let replyText: string | undefined;

  const toolDefs = extraToolDefs.length ? [...TOOL_DEFS, ...extraToolDefs] : TOOL_DEFS;
  const MAX_TURNS = 8;
  for (let i = 0; i < MAX_TURNS; i++) {
    const { result, usedModel } = await cascadeCall(effectiveCascade, {
      systemBlocks,
      messages,
      tools: toolDefs,
      maxTokens: 1024,
    });

    totalIn += result.usage.inputTokens;
    totalOut += result.usage.outputTokens;
    totalCached += result.usage.cachedTokens;
    modelUsed = usedModel.model;

    if (result.kind === "tool_use") {
      messages.push(result.assistantMessage);
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of result.toolUses) {
        const output = await executeTool(block.name, block.input, tools);
        toolCallsLog.push({ name: block.name, input: block.input, output });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(output),
        });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    replyText = result.text;
    break;
  }

  return {
    replyText,
    toolCalls: toolCallsLog,
    review: detectHallucination(replyText, toolCallsLog.map((t) => t.name)),
    llmUsage: {
      model: modelUsed,
      inputTokens: totalIn,
      outputTokens: totalOut,
      cachedTokens: totalCached,
      estimatedCostBRL: estimateCostBRL(modelUsed, totalIn, totalOut, totalCached),
    },
  };
}

async function executeTool(name: string, input: unknown, tools: AgentToolImpl): Promise<unknown> {
  const i = input as any;
  try {
    switch (name) {
      case "buscar_produto":       return await tools.buscarProduto(i);
      case "buscar_por_foto":
        if (!tools.buscarPorFoto) return { erro: "Busca por foto indisponível neste canal." };
        return await tools.buscarPorFoto({ precoMax: i.precoMax, tamanho: i.tamanho });
      case "mostrar_midia":        return await tools.mostrarMidia(i.produtoId, i.tipo);
      case "verificar_estoque":    return await tools.verificarEstoque(i.sku);
      case "consultar_frete":      return await tools.consultarFrete(i.cep, i.sku);
      case "atualizar_perfil":     await tools.atualizarPerfil(i); return { ok: true };
      case "reservar_item":        return await tools.reservarItem(i.sku, i.ttlMinutos);
      case "criar_pedido":         return await tools.criarPedido(i);
      case "status_pedido":        return await tools.statusPedido(i.pedidoId);
      case "cancelar_pedido":      return await tools.cancelarPedido(i.pedidoId, i.motivo);
      case "iniciar_devolucao":    return await tools.iniciarDevolucao(i.pedidoId, i.motivo);
      case "escalar_para_humano":  return await tools.escalarParaHumano(i.motivo);
      case "consultar_ficha":
        if (!tools.consultarFicha) return { erro: "Ficha técnica indisponível nesta loja." };
        return await tools.consultarFicha(i.sku);
      case "calcular_entrega_propria":
        if (!tools.calcularEntregaPropria) return { erro: "Entrega própria indisponível nesta loja." };
        return await tools.calcularEntregaPropria({ distanceKm: i.distanceKm, itens: i.itens });
      default: return { error: `Tool desconhecida: ${name}` };
    }
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}
