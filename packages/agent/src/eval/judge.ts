import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "../providers.js";

export type JudgeVerdict = { score: number; pass: boolean; reason: string };

/** Piso de qualidade abaixo do qual a resposta é considerada um defeito real (tom robótico, evasiva grave). */
export const JUDGE_FLOOR = 0.5;
/** Barra de qualidade "boa" — reportada na média, não bloqueia o gate. */
export const JUDGE_BAR = 0.7;

const JUDGE_MODEL = "claude-haiku-4-5-20251001";

/**
 * Juiz-LLM: nota a resposta da Maya de 0 a 1 contra a rubrica do cenário.
 * Roda num modelo barato (Haiku) e separado do agente sob teste.
 */
export async function judgeReply(args: {
  userMessage: string;
  reply: string;
  rubric: string;
}): Promise<JudgeVerdict> {
  const client = getAnthropicClient();

  const res = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 300,
    system:
      "Você é um avaliador de qualidade de atendimento de uma vendedora virtual brasileira (Maya). " +
      "Avalie a RESPOSTA contra a RUBRICA. Seja rigoroso com tom robótico, promessas inventadas e respostas evasivas. " +
      'Responda APENAS com JSON: {"score": <0..1>, "reason": "<curto, pt-BR>"}.',
    messages: [
      {
        role: "user",
        content:
          `MENSAGEM DA CLIENTE:\n${args.userMessage}\n\n` +
          `RESPOSTA DA MAYA:\n${args.reply || "(vazia)"}\n\n` +
          `RUBRICA:\n${args.rubric}\n\n` +
          `Dê a nota.`,
      },
    ],
  });

  const text = res.content.find((b): b is Anthropic.Messages.TextBlock => b.type === "text")?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { score: 0, pass: false, reason: `juiz não retornou JSON: ${text.slice(0, 120)}` };
  try {
    const parsed = JSON.parse(match[0]) as { score: number; reason: string };
    const score = Math.max(0, Math.min(1, Number(parsed.score)));
    return { score, pass: score >= JUDGE_FLOOR, reason: parsed.reason ?? "" };
  } catch {
    return { score: 0, pass: false, reason: `JSON inválido do juiz: ${match[0].slice(0, 120)}` };
  }
}
