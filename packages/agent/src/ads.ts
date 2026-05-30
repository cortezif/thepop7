/* ============================================================
   Theo — persona de mídia paga (ADR-028). Gera criativo de anúncio
   (headline, texto principal, CTA) a partir de um briefing + brand voice,
   no mesmo padrão das outras personas. Degrada graciosamente sem chave.
   ============================================================ */

import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export type AdCreative = {
  headline: string;       // título curto (≤ 40 chars idealmente)
  primaryText: string;    // texto principal do anúncio
  cta: string;            // chamada (ex: "Comprar agora", "Enviar mensagem")
};

const CTA_OPTIONS = ["Comprar agora", "Enviar mensagem", "Saiba mais", "Ver coleção", "Aproveitar"];

const TOOL: Anthropic.Messages.Tool = {
  name: "submit_ad_creative",
  description: "Submete o criativo do anúncio gerado (headline, texto principal e CTA).",
  input_schema: {
    type: "object",
    required: ["headline", "primaryText", "cta"],
    properties: {
      headline: { type: "string", description: "Título curto e chamativo (até ~40 caracteres)." },
      primaryText: { type: "string", description: "Texto principal do anúncio (2–4 frases, com gancho e benefício)." },
      cta: { type: "string", enum: CTA_OPTIONS, description: "Chamada para ação." },
    },
  },
};

export async function generateAdCreative(
  brief: {
    objective: string;            // mensagens | trafego | vendas | reconhecimento
    productOrOffer: string;       // o que está sendo anunciado
    audienceLabel?: string;       // público-alvo (ex: "comprou nos últimos 90d")
    storeName: string;
    brandVoice?: string;          // tom da loja (tenant.agentTone)
    segment?: string;
  },
  opts: { model?: string } = {},
): Promise<{ ok: true; creative: AdCreative } | { ok: false; error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "ANTHROPIC_API_KEY ausente" };
  const model = opts.model ?? process.env.CLAUDE_MODEL_AGENT ?? "claude-sonnet-4-6";

  const system = `Você é o Theo, especialista em mídia paga (Meta Ads) da loja "${brief.storeName}"${brief.segment ? ` (segmento: ${brief.segment})` : ""}.
Crie criativo de anúncio para ${brief.objective}. Tom da marca: ${brief.brandVoice ?? "próximo, brasileiro, confiável"}.
Regras: português do Brasil; headline curta; texto com gancho + benefício claro + prova/urgência leve;
nada de promessas falsas; sem emojis em excesso. Submeta via submit_ad_creative.`;

  try {
    const res = await client().messages.create({
      model, max_tokens: 500, system,
      tools: [TOOL], tool_choice: { type: "tool", name: "submit_ad_creative" },
      messages: [{
        role: "user",
        content: [
          `Anunciar: ${brief.productOrOffer}`,
          brief.audienceLabel ? `Público: ${brief.audienceLabel}` : "",
        ].filter(Boolean).join("\n"),
      }],
    });
    const toolUse = res.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
    if (!toolUse) return { ok: false, error: "sem tool_use" };
    const c = toolUse.input as AdCreative;
    if (!CTA_OPTIONS.includes(c.cta)) c.cta = "Saiba mais";
    return { ok: true, creative: c };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
