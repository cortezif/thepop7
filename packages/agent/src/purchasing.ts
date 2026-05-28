/* ============================================================
   Bia — persona de compras (ADR-021/026). Duas capacidades:

   1. parseSupplierQuote: lê a resposta do fornecedor em texto livre
      (WhatsApp/email) e extrai itens/preço/prazo de forma estruturada
      via tool use. Mesmo padrão do extractor de catálogo — fornecedor
      manda "o vestido 042 sai a 28, prazo 5 dias", vira JSON.

   2. composeQuoteRequest: gera a mensagem de solicitação de cotação
      pra mandar ao fornecedor (tom profissional, objetivo).
   ============================================================ */

import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export type ParsedQuote = {
  items: Array<{ description: string; unitPriceBRL: number; quantity: number }>;
  totalBRL: number;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  confidence: number;
};

const QUOTE_TOOL: Anthropic.Messages.Tool = {
  name: "submit_quote",
  description:
    "Submete a cotação extraída da resposta de um fornecedor. Extraia preços, " +
    "quantidades, prazo de entrega e condições de pagamento do texto livre. " +
    "Se algum dado não estiver claro, use null e baixe o confidence.",
  input_schema: {
    type: "object",
    required: ["items", "totalBRL", "confidence"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["description", "unitPriceBRL", "quantity"],
          properties: {
            description:  { type: "string" },
            unitPriceBRL: { type: "number", description: "Preço unitário em BRL" },
            quantity:     { type: "number" },
          },
        },
      },
      totalBRL:     { type: "number", description: "Total da cotação em BRL (soma ou valor informado)" },
      leadTimeDays: { type: ["number", "null"], description: "Prazo de entrega/postagem em dias" },
      paymentTerms: { type: ["string", "null"], description: "Condições de pagamento (ex: 'PIX à vista', '30 dias')" },
      confidence:   { type: "number", minimum: 0, maximum: 1 },
    },
  },
};

const PARSE_SYSTEM = `Você é a Bia, responsável por compras de uma loja de moda.
Recebe respostas de fornecedores (texto informal de WhatsApp ou email) e extrai
a cotação de forma estruturada. Fornecedores escrevem de forma solta, ex:
"o vestido floral sai 28 cada, levando 50 peças, prazo 5 dias úteis, pix antecipado".
Converta valores em número (28 → 28.00). Some o total se não for informado.
Nunca invente: dado ausente vira null e baixa o confidence.`;

export async function parseSupplierQuote(
  supplierMessage: string,
  context: { itemsRequested?: string },
  opts: { model?: string } = {}
): Promise<{ ok: true; quote: ParsedQuote } | { ok: false; error: string }> {
  const model = opts.model ?? process.env.CLAUDE_MODEL_FAST ?? "claude-haiku-4-5-20251001";
  try {
    const response = await client().messages.create({
      model,
      max_tokens: 600,
      system: PARSE_SYSTEM,
      tools: [QUOTE_TOOL],
      tool_choice: { type: "tool", name: "submit_quote" },
      messages: [{
        role: "user",
        content: [
          context.itemsRequested ? `Itens solicitados: ${context.itemsRequested}` : "",
          "Resposta do fornecedor:",
          supplierMessage,
        ].filter(Boolean).join("\n"),
      }],
    });
    const toolUse = response.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUse) return { ok: false, error: "sem tool_use" };
    return { ok: true, quote: toolUse.input as ParsedQuote };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/** Gera a mensagem de solicitação de cotação pro fornecedor. */
export async function composeQuoteRequest(
  items: Array<{ description: string; quantity: number }>,
  context: { storeName: string; supplierName?: string; channel?: "whatsapp" | "email" },
  opts: { model?: string } = {}
): Promise<string> {
  const model = opts.model ?? process.env.CLAUDE_MODEL_FAST ?? "claude-haiku-4-5-20251001";
  const itemList = items.map((i) => `- ${i.quantity}x ${i.description}`).join("\n");

  const response = await client().messages.create({
    model,
    max_tokens: 300,
    system: `Você é a Bia, de compras da loja "${context.storeName}". Escreva uma
mensagem ${context.channel === "email" ? "de email" : "de WhatsApp"} curta e profissional
solicitando cotação. Peça: preço unitário, prazo de entrega e condições de pagamento.
Tom objetivo e cordial. Não assine com placeholder.`,
    messages: [{
      role: "user",
      content: `Fornecedor: ${context.supplierName ?? "fornecedor"}\nItens para cotar:\n${itemList}`,
    }],
  });
  const textBlock = response.content.find((b): b is Anthropic.Messages.TextBlock => b.type === "text");
  return textBlock?.text ?? "";
}
