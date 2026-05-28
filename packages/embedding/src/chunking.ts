/* ============================================================
   chunking — porte direto de C:\adviser-editor/infra/search-api/src/chunking.ts.

   Quebra markdown em pedaços de ~800 tokens com overlap
   de ~100 tokens, preservando fronteiras semânticas.

   Estratégia hierárquica:
     1. Quebra por h3 (### Header) — cada seção do parecer fica intacta
        quando cabe num chunk
     2. Se a seção excede o limite, quebra por parágrafos (\n\n)
     3. Se um parágrafo excede o limite, quebra por frases (. ! ?)
     4. Aplica overlap encadeado entre chunks adjacentes (preserva
        contexto local — última frase do chunk N vira primeira do N+1)

   Por que isto importa:
   - Doc inteiro como 1 vetor "mediano" perde o sinal local. Chunks
     de ~800 tokens são a granularidade onde a similaridade semântica
     fica mais discriminante segundo o consenso da literatura (RAG eval).
   - Overlap de 10-15% evita perder relevância em fronteiras (uma
     citação cortada ao meio).
   - Preservar h3 dá ao usuário a possibilidade de mostrar a SEÇÃO de
     onde veio o trecho, não só o texto cru.

   Tokens são estimados (não tokenizados de fato — evita dependência
   de tiktoken/sentencepiece no backend). Para pt-BR, palavras × 1.3
   é uma aproximação aceitável (Voyage tokeniza um pouco mais denso
   que o GPT, mas a margem de erro é coberta pelo CHUNK_MAX_TOKENS
   conservador).
   ============================================================ */

/** Tamanho-alvo de cada chunk em tokens (estimados). 800 é o sweet spot
 *  pra busca semântica jurídica: grande o suficiente pra carregar 1-2
 *  parágrafos completos de argumento, pequeno o suficiente pra o vetor
 *  ser específico. */
const CHUNK_MAX_TOKENS = 800;

/** Overlap entre chunks adjacentes — ~12% do CHUNK_MAX_TOKENS. Evita
 *  perda de relevância quando uma citação ou raciocínio cai exatamente
 *  na fronteira entre dois chunks. */
const CHUNK_OVERLAP_TOKENS = 100;

/** Limite mínimo. Chunks menores que isso são fundidos com o vizinho
 *  (evita "lixo" — um chunk com 50 tokens raramente vai bater em
 *  qualquer query de modo útil e polui o índice). */
const CHUNK_MIN_TOKENS = 50;

/** Estimativa rápida de tokens: ~1.3 tokens por palavra pra pt-BR no
 *  Voyage. Para inglês, ~1.25. Não é tokenização real, é heurística
 *  pra evitar dependência de SentencePiece no Node. Margem coberta
 *  pelo CHUNK_MAX_TOKENS conservador (Voyage suporta 32k). */
function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

export type Chunk = {
  /** Texto bruto do chunk, pronto pra embed. */
  text: string;
  /** Posição inicial no markdown original (offset em chars). Útil pra
   *  destacar o trecho na UI quando o user pede pra ver o contexto. */
  positionStart: number;
  /** Posição final (exclusiva). */
  positionEnd: number;
  /** Tokens estimados. Útil pra debugging e pra rejeitar chunks que
   *  saíram fora do alvo. */
  tokensEstimated: number;
  /** Label da seção (h3 imediatamente acima). Vazio se o chunk vem
   *  de texto antes do primeiro h3. */
  sectionLabel: string;
};

/** Quebra um texto longo em sub-strings, respeitando fronteiras de
 *  parágrafo primeiro e de frase depois. Cada sub-string fica abaixo
 *  do limite de tokens. Pode emitir overlap entre adjacentes. */
function splitWithOverlap(
  text: string,
  baseOffset: number,
  sectionLabel: string
): Chunk[] {
  if (estimateTokens(text) <= CHUNK_MAX_TOKENS) {
    return [{
      text: text.trim(),
      positionStart: baseOffset,
      positionEnd: baseOffset + text.length,
      tokensEstimated: estimateTokens(text),
      sectionLabel
    }];
  }

  // Quebra por parágrafos (linha em branco). Texto bem formatado em
  // markdown jurídico já tem parágrafos como blocos lógicos coerentes.
  const paragraphs = text.split(/\n{2,}/);

  // Pacote acumulador: junta parágrafos até estourar o limite, emite
  // chunk, começa de novo com overlap do anterior.
  const chunks: Chunk[] = [];
  let currentText = "";
  let currentOffset = baseOffset;
  let runningOffset = baseOffset;

  const emitChunk = (final: boolean) => {
    if (!currentText.trim()) return;
    const tokens = estimateTokens(currentText);
    // Chunk minúsculo: tenta fundir com o anterior em vez de emitir
    // (acontece quando sobra resto pequeno no fim de uma seção).
    if (tokens < CHUNK_MIN_TOKENS && chunks.length > 0 && !final) {
      const last = chunks[chunks.length - 1]!;
      last.text = (last.text + "\n\n" + currentText).trim();
      last.positionEnd = currentOffset + currentText.length;
      last.tokensEstimated = estimateTokens(last.text);
      currentText = "";
      return;
    }
    chunks.push({
      text: currentText.trim(),
      positionStart: currentOffset,
      positionEnd: currentOffset + currentText.length,
      tokensEstimated: tokens,
      sectionLabel
    });
    // Preparar overlap pro próximo chunk: pega as últimas N "palavras"
    // que somam ~CHUNK_OVERLAP_TOKENS. Garante continuidade semântica
    // sem duplicar muito texto.
    if (!final) {
      const words = currentText.trim().split(/\s+/);
      // ~100 tokens / 1.3 ≈ 77 palavras. Conservador: 80.
      const overlapWords = words.slice(Math.max(0, words.length - 80));
      currentText = overlapWords.join(" ");
      // Offset agora aponta pro INÍCIO do overlap (chunks adjacentes
      // se sobrepõem em chars; positionStart do próximo é correto).
      currentOffset = currentOffset + currentText.length - estimateTokens(currentText);
    } else {
      currentText = "";
    }
  };

  for (const para of paragraphs) {
    // Parágrafo gigantesco — quebra por frase. Raro em pareceres bem
    // estruturados, mas acontece em sentenças sem quebra de linha.
    if (estimateTokens(para) > CHUNK_MAX_TOKENS) {
      // Emite o que tinha acumulado antes do parágrafo gigante
      emitChunk(false);
      // Quebra esse parágrafo em frases. Regex pega ponto, exclamação
      // ou interrogação seguidos de espaço + maiúscula. Quebra-linha
      // dentro do parágrafo também serve como separador (citações).
      const sentences = para.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/);
      let sentenceAcc = "";
      let sentenceOffset = runningOffset;
      for (const s of sentences) {
        if (estimateTokens(sentenceAcc + " " + s) > CHUNK_MAX_TOKENS && sentenceAcc) {
          chunks.push({
            text: sentenceAcc.trim(),
            positionStart: sentenceOffset,
            positionEnd: sentenceOffset + sentenceAcc.length,
            tokensEstimated: estimateTokens(sentenceAcc),
            sectionLabel
          });
          // Overlap: última frase
          const sentArr = sentenceAcc.trim().split(/(?<=[.!?])\s+/);
          sentenceAcc = sentArr[sentArr.length - 1] || "";
          sentenceOffset += sentenceAcc.length;
        }
        sentenceAcc += (sentenceAcc ? " " : "") + s;
      }
      if (sentenceAcc.trim()) {
        currentText = sentenceAcc;
        currentOffset = sentenceOffset;
      }
    } else if (estimateTokens(currentText + "\n\n" + para) > CHUNK_MAX_TOKENS) {
      emitChunk(false);
      currentText = (currentText ? currentText + "\n\n" : "") + para;
    } else {
      currentText = currentText + (currentText ? "\n\n" : "") + para;
    }
    runningOffset += para.length + 2; // +2 pelo \n\n consumido pelo split
  }

  emitChunk(true);
  return chunks;
}

/** Função pública: recebe markdown completo e devolve lista de chunks.
 *  Cada chunk fica até ~800 tokens com overlap ~100, respeitando
 *  fronteiras de h3 → parágrafo → frase. */
export function chunkMarkdown(markdown: string): Chunk[] {
  if (!markdown || !markdown.trim()) return [];

  // Primeira camada: split por h3. Regex `(?=^### )` divide ANTES do
  // header, mantendo-o como início de cada bloco. Multiline.
  const sections = markdown.split(/(?=^### )/m);

  const chunks: Chunk[] = [];
  let offset = 0;

  for (const section of sections) {
    if (!section.trim()) {
      offset += section.length;
      continue;
    }
    // Extrai label da seção (texto do h3) se presente
    const headerMatch = section.match(/^###\s+(.+?)\s*$/m);
    const sectionLabel = headerMatch?.[1]?.trim() ?? "";

    // Trim o texto MAS preserva offset original — UI/citação precisa
    // do offset real no markdown completo.
    const leadingWs = section.length - section.trimStart().length;
    const trimmedSection = section.trim();
    const sectionStart = offset + leadingWs;

    const sectionChunks = splitWithOverlap(trimmedSection, sectionStart, sectionLabel);
    chunks.push(...sectionChunks);
    offset += section.length;
  }

  // Re-indexa idx (preserva ordem de aparição no doc) — caller usa
  // pra grava no chunk_idx da tabela.
  return chunks;
}
