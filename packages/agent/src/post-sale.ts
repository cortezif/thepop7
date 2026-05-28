/* ============================================================
   Lia — persona de pós-venda (ADR-026). Gera as mensagens proativas
   dos marcos D+1/D+7/D+14/D+30 (ADR-010), referenciando o pedido real.

   Diferente da Maya (vendas): tom cuidadoso, resolutivo, foco em
   satisfação e fidelização. Não usa tool use — gera texto direto
   (mensagem proativa curta pra WhatsApp/IG).
   ============================================================ */

import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export type PostSaleStage = "d1" | "d7" | "d14" | "d30";

export type PostSaleContext = {
  personaName: string;       // ex: "Lia"
  storeName: string;
  customerName?: string;
  productNames: string[];    // peças do pedido
  deliveredTo?: string;      // quem recebeu
  returnDeadline?: string;   // data limite (D+7)
  tone?: string;             // tom da loja
};

const STAGE_BRIEF: Record<PostSaleStage, string> = {
  d1:
    "Primeiro contato após a entrega. Pergunte de forma calorosa se a peça chegou bem e " +
    "se caiu como ela esperava. Curta, sem pressão de venda. Abra espaço pra dúvida.",
  d7:
    "Lembrete amigável do prazo de devolução/troca. Informe a data limite de forma leve " +
    "(não alarmante), reforçando que é só se ela não tiver amado. Tranquilizadora.",
  d14:
    "Pesquisa de satisfação (NPS). Peça uma nota de 0 a 10 para o PRODUTO e uma para o " +
    "ATENDIMENTO, em uma única mensagem curta e simpática. Deixe claro que a resposta ajuda muito.",
  d30:
    "Reativação/recompra. Sugira de forma sutil que chegaram novidades que combinam com o " +
    "estilo dela, convidando a dar uma olhada. Sem ser insistente.",
};

/** Gera a mensagem proativa de pós-venda pro estágio dado. */
export async function generatePostSaleMessage(
  stage: PostSaleStage,
  ctx: PostSaleContext,
  opts: { model?: string } = {}
): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
  const model = opts.model ?? process.env.CLAUDE_MODEL_FAST ?? "claude-haiku-4-5-20251001";

  const system = `Você é a ${ctx.personaName}, responsável pelo pós-venda da loja "${ctx.storeName}".
Tom: ${ctx.tone || "cuidadoso, próximo, brasileiro, acolhedor"}.

Regras:
- Mensagem curta (2-4 frases), pronta pra enviar no WhatsApp.
- Use o nome da cliente se disponível.
- Emojis com muita parcimônia (no máximo 1).
- Nunca invente prazo ou dado — use só o que está no contexto.
- Não assine a mensagem.`;

  const contextLines = [
    ctx.customerName ? `Cliente: ${ctx.customerName}` : "",
    `Peça(s) do pedido: ${ctx.productNames.join(", ") || "(não informado)"}`,
    ctx.deliveredTo ? `Recebido por: ${ctx.deliveredTo}` : "",
    ctx.returnDeadline ? `Prazo de devolução até: ${ctx.returnDeadline}` : "",
    "",
    `Objetivo desta mensagem: ${STAGE_BRIEF[stage]}`,
  ].filter(Boolean).join("\n");

  const response = await client().messages.create({
    model,
    max_tokens: 300,
    system,
    messages: [{ role: "user", content: contextLines }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.Messages.TextBlock => b.type === "text"
  );
  return {
    text: textBlock?.text ?? "",
    usage: {
      inputTokens: response.usage.input_tokens ?? 0,
      outputTokens: response.usage.output_tokens ?? 0,
    },
  };
}
