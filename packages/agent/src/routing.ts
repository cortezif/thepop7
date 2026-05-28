/* ============================================================
   Smart routing — porte adaptado de
   C:\adviser-editor/apps/desktop/src/renderer/ai/aiSmartRouting.ts

   Adviser usa cascade Ollama → Groq → Haiku → Sonnet → Opus e
   filtra níveis baseado em (a) tamanho do input e (b) complexidade
   do schema da tool.

   Em tp7, o padrão é:
   - Conversa curta sem perfil → Haiku
   - Conversa com sinal claro de venda → Sonnet
   - Tool use com schema grande (extractors) → Sonnet direto
   - Reprocessing / fallback → mantém cascade completo
   ============================================================ */

import { DEFAULT_CASCADE, type ProviderModel } from "./providers.js";

export type RoutingContext = {
  /** Texto do user na rodada atual. */
  userMessage: string;
  /** Quantas voltas de conversa já aconteceram. */
  turnsSoFar: number;
  /** Tem perfil rico já coletado? (medidas, estilo, etc.) */
  hasRichProfile?: boolean;
  /** Hint vindo do caller. */
  intent?: "greeting" | "browse" | "purchase" | "complaint" | "support" | "enrichment";
  /** Total estimado de chars no system+history. */
  contextChars?: number;
};

const SALES_KEYWORDS = [
  "comprar","quero","vou levar","fechar","pagamento","pix","cartão","cartao",
  "frete","entrega","prazo","tamanho","medida","tem em estoque","disponível","disponivel",
  "valor","preço","preco","quanto",
];
const COMPLAINT_KEYWORDS = [
  "reclamar","reclamação","reclamacao","insatisfeit","horrível","horrivel","péssim","pessim",
  "atendente","supervisor","problema","defeito","quebrad","cancelar","devolução","devolucao",
  "reembols","procon","atrasad","sumiu","perdi","extraviad",
];

function detectIntent(text: string): RoutingContext["intent"] {
  const lower = text.toLowerCase();
  if (COMPLAINT_KEYWORDS.some((k) => lower.includes(k))) return "complaint";
  if (SALES_KEYWORDS.some((k) => lower.includes(k))) return "purchase";
  if (lower.length < 30 && /(oi|olá|ola|bom dia|boa tarde|boa noite|tudo bem)/i.test(lower)) {
    return "greeting";
  }
  return "browse";
}

/**
 * Retorna a cascade FILTRADA para o contexto atual.
 * Sempre devolve pelo menos 1 provider (nunca lista vazia).
 *
 * Regra simplificada:
 *   greeting (msg curta, sem perfil)   → Haiku
 *   browse                              → Haiku, Sonnet (fallback se Haiku errar tool)
 *   purchase                            → Sonnet, Haiku
 *   complaint                           → Sonnet (qualidade > custo aqui)
 *   enrichment (catálogo, vision)       → Sonnet direto
 *   default                             → cascade completo
 */
export function buildSmartCascade(ctx: RoutingContext): ProviderModel[] {
  const intent = ctx.intent ?? detectIntent(ctx.userMessage);
  const chars = ctx.contextChars ?? ctx.userMessage.length;

  const SONNET = DEFAULT_CASCADE.find((p) => p.model.includes("sonnet"))!;
  const HAIKU  = DEFAULT_CASCADE.find((p) => p.model.includes("haiku"))!;
  const GROQ   = DEFAULT_CASCADE.find((p) => p.provider === "groq");
  const OLLAMA = DEFAULT_CASCADE.find((p) => p.provider === "ollama");

  // Mensagem MUITO grande (> 8000 chars) — Llama local não aguenta tool use
  const veryLargeInput = chars > 8000;

  switch (intent) {
    case "greeting":
      return [HAIKU, SONNET];

    case "complaint":
      // Sempre Sonnet primeiro — atendimento sensível, qualidade importa
      return [SONNET, HAIKU];

    case "purchase":
      // Tem perfil rico ou input grande → Sonnet primeiro
      return ctx.hasRichProfile || veryLargeInput
        ? [SONNET, HAIKU]
        : [HAIKU, SONNET];

    case "enrichment":
      // Vision + JSON estruturado — só modelos premium acertam
      return [SONNET];

    case "browse":
    case "support":
    default: {
      // Browse / suporte: cascade completo mas com Sonnet no topo se input grande
      const base = veryLargeInput ? [SONNET, HAIKU] : [HAIKU, SONNET];
      // Adiciona fallbacks gratuitos no fim
      const fallbacks: ProviderModel[] = [];
      if (GROQ && !veryLargeInput) fallbacks.push(GROQ);
      if (OLLAMA && chars < 4000) fallbacks.push(OLLAMA);
      return [...base, ...fallbacks];
    }
  }
}

/** Helper público: detecta intent só pelo texto (sem precisar de RoutingContext completo). */
export { detectIntent };
