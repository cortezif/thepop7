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

import { DEFAULT_CASCADE, isProviderConfigured, type ProviderModel } from "./providers.js";

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

  // Mensagem MUITO grande (> 8000 chars) — Llama local não aguenta tool use
  const veryLargeInput = chars > 8000;

  // Base (modelos Anthropic) escolhida pela intenção/sinal de venda.
  let base: ProviderModel[];
  switch (intent) {
    case "greeting":   base = [HAIKU, SONNET]; break;
    case "complaint":  base = [SONNET, HAIKU]; break; // sensível: qualidade > custo
    case "purchase":   base = (ctx.hasRichProfile || veryLargeInput) ? [SONNET, HAIKU] : [HAIKU, SONNET]; break;
    case "enrichment": base = [SONNET]; break;        // JSON estruturado — premium
    case "browse":
    case "support":
    default:           base = veryLargeInput ? [SONNET, HAIKU] : [HAIKU, SONNET];
  }

  // Fallbacks externos (Gemini/Groq/DeepSeek/Grok) — só os que têm chave no
  // ambiente. Entram em TODA cascata pra sobreviver a outage/limite da Anthropic.
  // Ollama (local) só faz sentido em dev e com input não-gigante.
  const externals = DEFAULT_CASCADE.filter((p) => {
    if (p.provider === "anthropic") return false;
    if (p.provider === "ollama") return chars < 4000 && isProviderConfigured("ollama");
    return isProviderConfigured(p.provider);
  });

  // Dedup preservando ordem (base primeiro, depois externos).
  const seen = new Set<string>();
  return [...base, ...externals].filter((p) => {
    const k = `${p.provider}:${p.model}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Helper público: detecta intent só pelo texto (sem precisar de RoutingContext completo). */
export { detectIntent };
