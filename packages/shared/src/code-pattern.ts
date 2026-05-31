// Padrão de código próprio da loja (ADR-035). O dono/admin define os SEGMENTOS do
// código de barras/QR — cada um com significado e tamanho. Funções PURAS de montar
// e decodificar; sem dependências (usadas no API e no painel).
//
// Ex. loja de roupas: 26030104159030-0001-PP
//   2603(AnoMês) 01(Fornecedor) 04(Tipo) 159(Custo) 030(Margem) -0001(Nº peça)- PP(Tam)

export type SegmentKind =
  | "yymm"        // ano/mês da compra (AAMM) — automático
  | "supplier"    // código do fornecedor — manual
  | "productType" // tipo de peça (blusa/short/saia) — manual
  | "cost"        // preço de custo — do produto
  | "margin"      // margem de lucro — manual
  | "sequence"    // número sequencial da peça — automático
  | "size"        // tamanho (PP/M/GG) — da variante
  | "literal"     // texto fixo
  | "custom";     // campo livre digitado na hora

export type CodeSegment = {
  key: string;          // id único do segmento
  label: string;        // nome legível
  length: number;       // largura fixa (0 = variável: vai até o próximo separador/fim)
  kind: SegmentKind;
  value?: string;       // p/ "literal" (texto fixo)
  sepBefore?: string;   // separador imediatamente antes deste segmento (ex.: "-")
};

export type CodePattern = { segments: CodeSegment[] };

const VALID_KINDS: SegmentKind[] = ["yymm", "supplier", "productType", "cost", "margin", "sequence", "size", "literal", "custom"];
// Segmentos numéricos: preenchidos com zeros à esquerda até o tamanho.
const NUMERIC: SegmentKind[] = ["yymm", "supplier", "productType", "cost", "margin", "sequence"];

/** Padrão sugerido para lojas de roupas (ADR-035). */
export const DEFAULT_CLOTHING_PATTERN: CodePattern = {
  segments: [
    { key: "anoMes",     label: "Ano/Mês da compra", length: 4, kind: "yymm" },
    { key: "fornecedor", label: "Fornecedor",        length: 2, kind: "supplier" },
    { key: "tipo",       label: "Tipo de peça",      length: 2, kind: "productType" },
    { key: "custo",      label: "Preço de custo",    length: 3, kind: "cost" },
    { key: "margem",     label: "Margem de lucro",   length: 3, kind: "margin" },
    { key: "numero",     label: "Número da peça",    length: 4, kind: "sequence", sepBefore: "-" },
    { key: "tamanho",    label: "Tamanho",           length: 0, kind: "size",     sepBefore: "-" },
  ],
};

const onlyDigits = (s: string) => (s ?? "").replace(/\D/g, "");

/** Formata UM segmento conforme o tipo/tamanho. Pura. */
export function formatSegment(seg: CodeSegment, raw: string | undefined): string {
  if (seg.kind === "literal") return (seg.value ?? "").toUpperCase();
  let v = (raw ?? "").toString().trim();
  if (NUMERIC.includes(seg.kind)) {
    v = onlyDigits(v);
    if (seg.length > 0) return v.padStart(seg.length, "0").slice(-seg.length);
    return v;
  }
  // size/custom: maiúsculas; corta no tamanho fixo (0 = livre).
  v = v.toUpperCase().replace(/\s+/g, "");
  return seg.length > 0 ? v.slice(0, seg.length).padEnd(seg.length, "0") : v;
}

/** Monta o código a partir dos valores por segmento. Pura. */
export function buildCode(pattern: CodePattern, values: Record<string, string | undefined>): string {
  let out = "";
  for (const seg of pattern.segments) {
    if (seg.sepBefore) out += seg.sepBefore;
    out += formatSegment(seg, seg.kind === "literal" ? seg.value : values[seg.key]);
  }
  return out;
}

export type DecodedSegment = { key: string; label: string; value: string };

/** Decodifica um código de volta nos segmentos (key/label/value). Pura. */
export function decodeCode(pattern: CodePattern, code: string): DecodedSegment[] {
  const seps = pattern.segments.map((s) => s.sepBefore).filter(Boolean) as string[];
  const out: DecodedSegment[] = [];
  let i = 0;
  for (let idx = 0; idx < pattern.segments.length; idx++) {
    const seg = pattern.segments[idx]!;
    if (seg.sepBefore) {
      // Consome o separador (tolera ausência).
      if (code.slice(i, i + seg.sepBefore.length) === seg.sepBefore) i += seg.sepBefore.length;
    }
    let value: string;
    if (seg.length > 0) {
      value = code.slice(i, i + seg.length);
      i += seg.length;
    } else {
      // Variável: vai até o próximo separador conhecido ou o fim.
      let end = code.length;
      for (const sp of seps) {
        const at = code.indexOf(sp, i);
        if (at >= 0 && at < end) end = at;
      }
      value = code.slice(i, end);
      i = end;
    }
    out.push({ key: seg.key, label: seg.label, value });
  }
  return out;
}

/** Template legível do padrão (ex.: "AAMM-FF-TT-CCC-MMM-NNNN-TAM"). Pura. */
export function describePattern(pattern: CodePattern): string {
  const ch: Record<SegmentKind, string> = {
    yymm: "A", supplier: "F", productType: "T", cost: "C", margin: "M",
    sequence: "N", size: "Z", literal: "X", custom: "?",
  };
  return pattern.segments
    .map((s) => (s.sepBefore ?? "") + (s.kind === "literal" ? (s.value ?? "") : (ch[s.kind].repeat(s.length || 2))))
    .join("");
}

export type CodeContext = {
  yymm?: string;            // ano/mês AAMM (auto)
  costReais?: number;       // custo inteiro em reais (do produto)
  sizeText?: string;        // tamanho da variante
  sequence?: number;        // nº sequencial da peça
  manual?: Record<string, string>; // fornecedor/tipo/margem/custom digitados
};

/** Resolve o valor de cada segmento a partir do contexto (auto + manual). Pura. */
export function buildCodeFromContext(pattern: CodePattern, ctx: CodeContext): string {
  const m = ctx.manual ?? {};
  const values: Record<string, string> = {};
  for (const seg of pattern.segments) {
    switch (seg.kind) {
      case "yymm":     values[seg.key] = ctx.yymm ?? ""; break;
      case "cost":     values[seg.key] = ctx.costReais != null ? String(Math.round(ctx.costReais)) : ""; break;
      case "size":     values[seg.key] = ctx.sizeText ?? ""; break;
      case "sequence": values[seg.key] = ctx.sequence != null ? String(ctx.sequence) : ""; break;
      case "literal":  break; // usa seg.value
      default:         values[seg.key] = m[seg.key] ?? ""; // supplier/productType/margin/custom
    }
  }
  return buildCode(pattern, values);
}

/** Valores de exemplo p/ um código demonstrativo. Pura. */
export function sampleValues(pattern: CodePattern): Record<string, string> {
  const ex: Partial<Record<SegmentKind, string>> = {
    yymm: "2603", supplier: "01", productType: "04", cost: "159", margin: "030",
    sequence: "0001", size: "PP", custom: "X",
  };
  const v: Record<string, string> = {};
  for (const s of pattern.segments) if (s.kind !== "literal") v[s.key] = ex[s.kind] ?? "";
  return v;
}

/** Valida o padrão; devolve lista de erros (vazia = ok). Pura. */
export function validatePattern(pattern: unknown): string[] {
  const errs: string[] = [];
  const p = pattern as CodePattern;
  if (!p || !Array.isArray(p.segments) || p.segments.length === 0) return ["O padrão precisa de ao menos um segmento."];
  const keys = new Set<string>();
  for (const [i, s] of p.segments.entries()) {
    if (!s.key || typeof s.key !== "string") errs.push(`Segmento ${i + 1}: identificador (key) obrigatório.`);
    else if (keys.has(s.key)) errs.push(`Segmento "${s.key}": identificador duplicado.`);
    else keys.add(s.key);
    if (!s.label) errs.push(`Segmento "${s.key}": rótulo obrigatório.`);
    if (!VALID_KINDS.includes(s.kind)) errs.push(`Segmento "${s.key}": tipo inválido (${s.kind}).`);
    if (typeof s.length !== "number" || s.length < 0 || s.length > 20) errs.push(`Segmento "${s.key}": tamanho deve ser 0–20.`);
    if (s.kind === "literal" && !s.value) errs.push(`Segmento "${s.key}": texto fixo obrigatório no tipo "literal".`);
  }
  // Só o último segmento pode ser variável (length 0) — senão a decodificação fica ambígua.
  p.segments.forEach((s, i) => {
    if (s.length === 0 && i !== p.segments.length - 1 && !p.segments[i + 1]?.sepBefore) {
      errs.push(`Segmento "${s.key}": tamanho variável só é permitido no fim ou seguido de um separador.`);
    }
  });
  return errs;
}
