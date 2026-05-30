import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./providers.js";

const SUMMARY_MODEL = "claude-haiku-4-5-20251001";

/**
 * Resume uma conversa encerrada num parágrafo curto pra servir de MEMÓRIA
 * na próxima vez que a cliente voltar (ADR-007). Roda num modelo barato (Haiku).
 * Foco: o que a cliente queria, o que aconteceu (comprou/desistiu/pendente),
 * preferências reveladas e qualquer pendência em aberto.
 */
export async function summarizeConversation(input: {
  storeName: string;
  persona: string;
  messages: Array<{ direction: "in" | "out"; text: string }>;
}): Promise<string> {
  const turns = input.messages.filter((m) => m.text?.trim());
  if (turns.length === 0) return "";

  const transcript = turns
    .map((m) => `${m.direction === "in" ? "Cliente" : input.persona}: ${m.text}`)
    .join("\n");

  const client = getAnthropicClient();
  const res = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 220,
    system:
      `Você resume conversas de atendimento da loja "${input.storeName}" para servir de memória na próxima conversa. ` +
      "Escreva em português, 1 a 3 frases, em terceira pessoa, factual. Capture: o que a cliente buscava, " +
      "o desfecho (comprou / desistiu / ficou de pensar / pediu humano), preferências/medidas reveladas e pendências em aberto. " +
      "NÃO invente nada que não esteja na conversa. Se a conversa foi vazia ou irrelevante, responda apenas: (sem conteúdo relevante).",
    messages: [{ role: "user", content: `Conversa:\n${transcript}\n\nResumo:` }],
  });

  const text = res.content.find((b): b is Anthropic.Messages.TextBlock => b.type === "text")?.text?.trim() ?? "";
  return text === "(sem conteúdo relevante)" ? "" : text;
}
