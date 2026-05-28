/* ============================================================
   Voyage AI client — porte direto do adviser-editor (search-api/voyage.ts).
   Mesmo modelo voyage-3 (1024 dim, multilingual com pt-BR forte),
   mesma estratégia de degradação graciosa quando VOYAGE_API_KEY ausente.

   Documento médio (~2k tokens) ≈ $0.0003. Mil produtos ≈ $0.30 pra
   indexar o catálogo todo.
   ============================================================ */

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = process.env.VOYAGE_MODEL ?? "voyage-3";
const MAX_CHARS_PER_DOC = 100_000;

export type EmbedResult = {
  embedding: number[];
  tokensUsed: number;
};

/** Retorna embedding do texto OU null quando Voyage não está configurado.
 *  null = "siga sem embedding" — busca semântica desativa, BM25 segue.
 *  Em caso de erro de rede/API, lança. */
export async function embedDocument(
  text: string,
  apiKeyOverride?: string
): Promise<EmbedResult | null> {
  return embedInternal(text, "document", apiKeyOverride);
}

/** Embedding de uma QUERY do user — usa input_type="query" pra otimizar
 *  retrieval. Voyage diferencia esses dois lados pra melhorar precisão. */
export async function embedQuery(
  text: string,
  apiKeyOverride?: string
): Promise<EmbedResult | null> {
  return embedInternal(text, "query", apiKeyOverride);
}

async function embedInternal(
  text: string,
  inputType: "document" | "query",
  apiKeyOverride?: string
): Promise<EmbedResult | null> {
  const apiKey = (apiKeyOverride && apiKeyOverride.trim()) || process.env.VOYAGE_API_KEY;
  if (!apiKey) return null;
  if (!text || text.trim().length === 0) return null;

  const truncated = text.length > MAX_CHARS_PER_DOC ? text.slice(0, MAX_CHARS_PER_DOC) : text;

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      input: [inputType === "query" ? truncated.slice(0, 8000) : truncated],
      model: VOYAGE_MODEL,
      input_type: inputType,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Voyage API ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as { data: Array<{ embedding: number[] }>; usage: { total_tokens: number } };
  const first = data.data?.[0]?.embedding;
  if (!first || first.length !== 1024) {
    throw new Error(`Voyage retornou vetor de dim ${first?.length ?? 0}; esperado 1024`);
  }
  return { embedding: first, tokensUsed: data.usage?.total_tokens ?? 0 };
}

/** Converte array de números pro formato literal do pgvector pra usar
 *  em INSERT/UPDATE: '[1,2,3,...]'. pg-node não tem driver nativo de
 *  vector — vai como string e o cast `::vector` no SQL converte. */
export function vectorToPgLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
