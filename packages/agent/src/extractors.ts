/* ============================================================
   Extractors — padrão portado de C:\adviser-editor/aiExtractors.ts.

   Adviser usa tool use pra extrair JSON estruturado de documentos
   (modelo, fundamentos, snippets). Aqui adaptamos pra extrair
   ATRIBUTOS DE PRODUTO de moda a partir de nome + descrição + fotos.

   Por que tool use em vez de "resposta JSON":
   - Garante schema: enum de estilos, ocasiões, decotes, comprimentos
   - Confidence score por atributo
   - Sem parsing de texto livre (fonte de bugs)
   - Permite múltiplas voltas (cascade Sonnet → Haiku) sem perder estrutura
   ============================================================ */

import Anthropic from "@anthropic-ai/sdk";

// ====== Vocabulário fechado — alinhado com schema.prisma e o catálogo ======
export const STYLES = [
  "moderno", "evangelico", "romantico", "festa", "fitness", "casual",
  "classico", "vintage", "boho", "minimalista",
] as const;

export const OCCASIONS = [
  "trabalho", "balada", "igreja", "dia-a-dia", "casamento", "viagem",
  "praia", "academia", "casa", "eventos-formais",
] as const;

export const NECKLINES = ["alto", "medio", "baixo"] as const;
export const LENGTHS = ["curto", "medio", "longo"] as const;
export const SLEEVE_TYPES = ["sem", "curta", "3-4", "longa"] as const;

export type ExtractedProductAttributes = {
  styles: string[];        // 1..3 itens de STYLES
  occasions: string[];     // 1..3 itens de OCCASIONS
  neckline: string;        // NECKLINES
  sheer: boolean;          // tem transparência
  length: string;          // LENGTHS
  sleeveType: string;      // SLEEVE_TYPES
  confidence: number;      // 0..1
  reasoning: string;       // por que sugeriu isso (auditoria)
};

// ====== Tool schema — modelo "submit_*" como o adviser ======
const PRODUCT_ATTRIBUTES_TOOL: Anthropic.Messages.Tool = {
  name: "submit_product_attributes",
  description:
    "Submete os atributos enriquecidos extraídos de um produto de moda " +
    "feminina. Use APENAS valores do vocabulário fornecido. Se incerto, " +
    "reporte confidence baixo e priorize valores conservadores.",
  input_schema: {
    type: "object",
    required: ["styles", "occasions", "neckline", "sheer", "length", "sleeveType", "confidence", "reasoning"],
    properties: {
      styles: {
        type: "array",
        items: { type: "string", enum: [...STYLES] },
        minItems: 1, maxItems: 3,
        description: `Até 3 estilos. Vocabulário: ${STYLES.join(", ")}.`,
      },
      occasions: {
        type: "array",
        items: { type: "string", enum: [...OCCASIONS] },
        minItems: 1, maxItems: 3,
        description: `Até 3 ocasiões de uso. Vocabulário: ${OCCASIONS.join(", ")}.`,
      },
      neckline: {
        type: "string", enum: [...NECKLINES],
        description: "alto = fechado/gola; medio = padrão; baixo = decotado",
      },
      sheer: {
        type: "boolean",
        description: "true se tem qualquer transparência/tule/véu visível",
      },
      length: {
        type: "string", enum: [...LENGTHS],
        description: "curto = acima do joelho; medio = altura do joelho; longo = abaixo",
      },
      sleeveType: {
        type: "string", enum: [...SLEEVE_TYPES],
        description: "sem | curta | 3-4 | longa",
      },
      confidence: {
        type: "number", minimum: 0, maximum: 1,
        description: "Confiança geral (0..1). Use <0.5 se foto for ruim ou peça ambígua.",
      },
      reasoning: {
        type: "string",
        description: "Uma frase explicando a inferência. Vai pra auditoria.",
      },
    },
  },
};

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export type ExtractInput = {
  productName: string;
  description?: string;
  photoUrls?: string[];   // Claude vision aceita até 20 imagens
};

export type ExtractResult =
  | { ok: true; attributes: ExtractedProductAttributes; usage: { inputTokens: number; outputTokens: number } }
  | { ok: false; error: string };

const SYSTEM = `Você é uma curadora de moda feminina brasileira. Sua função é
analisar um produto (nome, descrição, foto) e classificá-lo com tags estruturadas
que vão alimentar busca semântica e recomendação para clientes.

Regras:
- Use APENAS o vocabulário das ferramentas. Nunca invente categorias.
- "evangelico" significa modesto, sem decote acentuado, sem transparência ousada.
- "fitness" implica peça pra atividade física, malha técnica.
- Em caso de dúvida visual, prefira valores conservadores (decote medio, manga curta)
  e baixe o confidence.
- Sempre forneça reasoning curto explicando a inferência.`;

// ====== Sanitização pós-resposta ======
// tool_choice forçado garante que o modelo CHAME a tool, mas não força adesão
// estrita ao enum — o Haiku às vezes devolve valores fora do vocabulário
// (ex.: "passeio", "eventos-informais"). Em vez de rejeitar a resposta inteira,
// filtramos/corrigimos e logamos o desvio (sinal pra ajustar o prompt/system).

function filterToVocab(
  values: unknown,
  vocab: readonly string[],
  field: string,
  fallback: string,
  productName: string
): string[] {
  const arr = Array.isArray(values) ? values : [];
  const kept: string[] = [];
  for (const v of arr) {
    if (typeof v === "string" && (vocab as readonly string[]).includes(v)) {
      kept.push(v);
    } else {
      console.warn(
        `[extractProductAttributes] valor fora do vocabulário em "${field}": ` +
          `${JSON.stringify(v)} (produto: ${productName})`
      );
    }
  }
  if (kept.length === 0) {
    console.warn(
      `[extractProductAttributes] "${field}" vazio após sanitização — ` +
        `usando fallback "${fallback}" (produto: ${productName})`
    );
    return [fallback];
  }
  return kept.slice(0, 3);
}

function validateScalar(
  value: unknown,
  vocab: readonly string[],
  field: string,
  fallback: string,
  productName: string
): string {
  if (typeof value === "string" && (vocab as readonly string[]).includes(value)) {
    return value;
  }
  console.warn(
    `[extractProductAttributes] valor inválido em "${field}": ` +
      `${JSON.stringify(value)} — usando fallback "${fallback}" (produto: ${productName})`
  );
  return fallback;
}

export function sanitizeAttributes(
  raw: ExtractedProductAttributes,
  productName: string
): ExtractedProductAttributes {
  return {
    ...raw,
    styles: filterToVocab(raw.styles, STYLES, "styles", "casual", productName),
    occasions: filterToVocab(raw.occasions, OCCASIONS, "occasions", "dia-a-dia", productName),
    // fallbacks conservadores, alinhados com o SYSTEM ("decote medio, manga curta")
    neckline: validateScalar(raw.neckline, NECKLINES, "neckline", "medio", productName),
    length: validateScalar(raw.length, LENGTHS, "length", "medio", productName),
    sleeveType: validateScalar(raw.sleeveType, SLEEVE_TYPES, "sleeveType", "curta", productName),
  };
}

/**
 * Extrai atributos enriquecidos de um produto via Claude vision + tool use.
 * Modelo padrão: Haiku 4.5 (rápido + barato, qualidade suficiente pra moda).
 * Em produção, usar Sonnet 4.6 quando confiança for crítica.
 */
export async function extractProductAttributes(
  input: ExtractInput,
  opts: { model?: string; maxTokens?: number } = {}
): Promise<ExtractResult> {
  const model = opts.model ?? process.env.CLAUDE_MODEL_FAST ?? "claude-haiku-4-5-20251001";

  // Constrói mensagem user com texto + imagens
  // (SDK 0.27 não exporta ContentBlockParam — usamos any controlado)
  const contentBlocks: any[] = [
    {
      type: "text",
      text: [
        `Produto: ${input.productName}`,
        input.description ? `Descrição: ${input.description}` : "",
        "",
        "Analise e submeta os atributos via submit_product_attributes.",
      ].filter(Boolean).join("\n"),
    },
  ];

  // Anexa imagens via URL (Claude faz download). Limite de 20 imagens por turn.
  for (const url of (input.photoUrls ?? []).slice(0, 5)) {
    contentBlocks.push({
      type: "image",
      source: { type: "url", url },
    });
  }

  try {
    const response = await client().messages.create({
      model,
      max_tokens: opts.maxTokens ?? 1024,
      system: SYSTEM,
      tools: [PRODUCT_ATTRIBUTES_TOOL],
      tool_choice: { type: "tool", name: "submit_product_attributes" },
      messages: [{ role: "user", content: contentBlocks }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUse) return { ok: false, error: "Modelo não retornou tool_use" };

    const raw = toolUse.input as ExtractedProductAttributes;
    const attrs = sanitizeAttributes(raw, input.productName);
    return {
      ok: true,
      attributes: attrs,
      usage: {
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
