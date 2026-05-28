/* ============================================================
   Provider cascade — adaptado do adviser-editor/aiProviders.ts.
   Mesma ideia: cada provider implementa a mesma assinatura
   (mensagens + tools → texto/tool_use + usage). O agente roda
   um cascade configurável (ex: Sonnet → Haiku → Groq → Ollama).

   Por que: durante outage Anthropic, ou em mensagens triviais,
   dá pra cair pra Groq (Llama hospedado, free tier) ou Ollama
   local (Llama 3 self-hosted) sem perder serviço.
   ============================================================ */

import Anthropic from "@anthropic-ai/sdk";
import { computeCacheKey, getCacheEntry, setCacheEntry } from "./cache.js";

export type ProviderId = "anthropic" | "groq" | "ollama" | "gemini" | "deepseek";

export type ProviderModel = {
  provider: ProviderId;
  model: string;
  /** Custo relativo (0=grátis, 1=Haiku, 3=Sonnet, 15=Opus). */
  costWeight: number;
  label: string;
};

export const DEFAULT_CASCADE: ProviderModel[] = [
  { provider: "anthropic", model: "claude-sonnet-4-6",           costWeight: 3,  label: "Sonnet 4.6" },
  { provider: "anthropic", model: "claude-haiku-4-5-20251001",   costWeight: 1,  label: "Haiku 4.5" },
  { provider: "groq",      model: "llama-3.3-70b-versatile",     costWeight: 0,  label: "Groq Llama 70B" },
  { provider: "ollama",    model: "llama3.1:8b",                 costWeight: 0,  label: "Ollama local" },
];

type ToolDef = Anthropic.Messages.Tool;
type Msg = Anthropic.Messages.MessageParam;
type SystemBlocks = Anthropic.Messages.MessageCreateParams["system"];

export type ProviderCallInput = {
  systemBlocks: SystemBlocks;
  messages: Msg[];
  tools: ToolDef[];
  maxTokens?: number;
};

export type ProviderCallResult =
  | { kind: "text"; text: string; usage: ProviderUsage }
  | { kind: "tool_use"; assistantMessage: Anthropic.Messages.MessageParam; toolUses: Anthropic.Messages.ToolUseBlock[]; usage: ProviderUsage };

export type ProviderUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
};

let _anthropic: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

/** Chamada unificada — internamente roteia pro provider correto. */
export async function providerCall(pm: ProviderModel, input: ProviderCallInput): Promise<ProviderCallResult> {
  switch (pm.provider) {
    case "anthropic": return anthropicCall(pm.model, input);
    case "groq":      return groqCall(pm.model, input);
    case "ollama":    return ollamaCall(pm.model, input);
    default:
      throw new Error(`Provider ainda não implementado: ${pm.provider}`);
  }
}

/** Roda o cascade: tenta na ordem, cai pro próximo em caso de erro recuperável. */
export async function cascadeCall(
  cascade: ProviderModel[],
  input: ProviderCallInput,
  log?: (msg: string, meta?: unknown) => void
): Promise<{ result: ProviderCallResult; usedModel: ProviderModel }> {
  let lastError: unknown = null;
  for (const pm of cascade) {
    try {
      const result = await providerCall(pm, input);
      return { result, usedModel: pm };
    } catch (e) {
      lastError = e;
      log?.(`[cascade] ${pm.label} falhou: ${(e as Error).message ?? e}`, { pm });
      if (!isRecoverable(e)) throw e;
    }
  }
  throw lastError ?? new Error("Cascade exausto sem provider funcional");
}

function isRecoverable(e: unknown): boolean {
  const msg = ((e as Error)?.message ?? "").toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("overloaded") ||
    msg.includes("timeout") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("connect") ||
    msg.includes("econnrefused")
  );
}

// ============================================================
// Anthropic — com cache LRU (ports do adviser/aiCache.ts)
// ============================================================
async function anthropicCall(model: string, input: ProviderCallInput): Promise<ProviderCallResult> {
  // Cache lookup — só ativa se cliente quiser idempotência
  // (controlado por env CACHE_AGENT=1 em dev).
  const cacheEnabled = process.env.CACHE_AGENT !== "0";
  const cacheKey = cacheEnabled
    ? computeCacheKey({
        model,
        system: input.systemBlocks,
        tools: input.tools,
        messages: input.messages,
      })
    : null;

  if (cacheKey) {
    const cached = getCacheEntry(cacheKey);
    if (cached) return cached.body as ProviderCallResult;
  }

  const response = await anthropic().messages.create({
    model,
    max_tokens: input.maxTokens ?? 1024,
    system: input.systemBlocks,
    tools: input.tools,
    messages: input.messages,
  });

  const usage = response.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  const u: ProviderUsage = {
    model,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cachedTokens: usage.cache_read_input_tokens ?? 0,
  };

  let result: ProviderCallResult;
  if (response.stop_reason === "tool_use") {
    const toolUses = response.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
    result = {
      kind: "tool_use",
      assistantMessage: { role: "assistant", content: response.content },
      toolUses,
      usage: u,
    };
  } else {
    const textBlock = response.content.find((b): b is Anthropic.Messages.TextBlock => b.type === "text");
    result = { kind: "text", text: textBlock?.text ?? "", usage: u };
  }

  // Cacheia somente respostas finais de texto (tool_use é parcial — não vale)
  if (cacheKey && result.kind === "text") {
    setCacheEntry(cacheKey, result, model);
  }
  return result;
}

// ============================================================
// Groq (OpenAI-compatible, sem suporte completo a system blocks/cache)
// ============================================================
async function groqCall(model: string, input: ProviderCallInput): Promise<ProviderCallResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY ausente");

  // Concatena blocos system em um único texto (Groq não tem cache_control)
  const systemText = Array.isArray(input.systemBlocks)
    ? input.systemBlocks.map((b: any) => b.text ?? "").join("\n\n")
    : String(input.systemBlocks ?? "");

  const openAIMessages = [
    { role: "system", content: systemText },
    ...input.messages.map(toOpenAIMessage),
  ];

  const openAITools = input.tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: openAIMessages, tools: openAITools, max_tokens: input.maxTokens ?? 1024 }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;

  const choice = data.choices?.[0]?.message;
  const usage: ProviderUsage = {
    model,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    cachedTokens: 0,
  };

  if (choice?.tool_calls?.length) {
    const toolUses: Anthropic.Messages.ToolUseBlock[] = choice.tool_calls.map((tc: any) => ({
      type: "tool_use",
      id: tc.id,
      name: tc.function.name,
      input: tryParseJSON(tc.function.arguments),
    }));
    return {
      kind: "tool_use",
      assistantMessage: { role: "assistant", content: toolUses as any },
      toolUses,
      usage,
    };
  }
  return { kind: "text", text: choice?.content ?? "", usage };
}

// ============================================================
// Ollama (local, sem custo, sem rate limit)
// ============================================================
async function ollamaCall(model: string, input: ProviderCallInput): Promise<ProviderCallResult> {
  const baseUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const systemText = Array.isArray(input.systemBlocks)
    ? input.systemBlocks.map((b: any) => b.text ?? "").join("\n\n")
    : String(input.systemBlocks ?? "");

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: "system", content: systemText }, ...input.messages.map(toOpenAIMessage)],
      tools: input.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      })),
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;

  const usage: ProviderUsage = {
    model,
    inputTokens: data.prompt_eval_count ?? 0,
    outputTokens: data.eval_count ?? 0,
    cachedTokens: 0,
  };

  const toolCalls = data.message?.tool_calls;
  if (toolCalls?.length) {
    const toolUses: Anthropic.Messages.ToolUseBlock[] = toolCalls.map((tc: any, i: number) => ({
      type: "tool_use",
      id: `ollama-${Date.now()}-${i}`,
      name: tc.function.name,
      input: tc.function.arguments,
    }));
    return {
      kind: "tool_use",
      assistantMessage: { role: "assistant", content: toolUses as any },
      toolUses,
      usage,
    };
  }
  return { kind: "text", text: data.message?.content ?? "", usage };
}

// ----- helpers -----
function toOpenAIMessage(m: Msg): { role: string; content: string } {
  const content = typeof m.content === "string"
    ? m.content
    : m.content
        .map((b: any) => (b.type === "text" ? b.text : b.type === "tool_result" ? `Tool result: ${typeof b.content === "string" ? b.content : JSON.stringify(b.content)}` : ""))
        .join("\n");
  return { role: m.role, content };
}

function tryParseJSON(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
