// Consolidação de preços da mercadológica (ADR-029). Função pura, testável.
// Adaptada do padrão de pesquisa de preços do app C:\ple, sem a amarração
// normativa pública: aqui o método e os fatores de descarte são livres.

export type EstimationMethod = "media" | "mediana" | "menor-preco";

export type ConsolidationOptions = {
  method?: EstimationMethod;
  /** Limiar p/ descartar preços ACIMA da mediana (0.5 = 50% acima). */
  upperFactor?: number;
  /** Limiar p/ descartar preços ABAIXO da mediana (0.5 = 50% abaixo). */
  lowerFactor?: number;
};

export type DiscardedQuote = {
  value: number;
  reason: "inexequivel" | "excessivamente-elevado";
};

export type ConsolidationResult = {
  validPrices: number[];
  discarded: DiscardedQuote[];
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
  coefficientOfVariation: number; // desvio-padrão / média
  method: EstimationMethod;
  estimate: number; // valor final pelo método escolhido
  meetsMinimumThree: boolean; // boa prática: ≥ 3 preços
  dispersionAlert: boolean; // CV > 0.25 → revisar
};

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Consolida uma lista de preços: descarta outliers (relativos à mediana),
 * calcula estatísticas e devolve a estimativa pelo método escolhido.
 */
export function consolidatePrices(
  prices: readonly number[],
  options: ConsolidationOptions = {},
): ConsolidationResult {
  const method = options.method ?? "mediana";
  const upperFactor = options.upperFactor ?? 0.5;
  const lowerFactor = options.lowerFactor ?? 0.5;

  const clean = prices.filter((p) => Number.isFinite(p) && p > 0);
  const sortedAll = [...clean].sort((a, b) => a - b);
  const baseMedian = median(sortedAll);

  // Descarte de outliers relativos à mediana (só quando há base suficiente)
  const discarded: DiscardedQuote[] = [];
  let valid = clean;
  if (clean.length >= 3 && baseMedian > 0) {
    const upper = baseMedian * (1 + upperFactor);
    const lower = baseMedian * (1 - lowerFactor);
    valid = [];
    for (const p of clean) {
      if (p > upper) discarded.push({ value: p, reason: "excessivamente-elevado" });
      else if (p < lower) discarded.push({ value: p, reason: "inexequivel" });
      else valid.push(p);
    }
    if (valid.length === 0) valid = clean; // fallback: não zera tudo
  }

  const sorted = [...valid].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  const mean = n ? sum / n : 0;
  const med = median(sorted);
  const min = n ? sorted[0]! : 0;
  const max = n ? sorted[n - 1]! : 0;
  const variance = n ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n : 0;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0;

  const estimate =
    method === "media" ? mean : method === "menor-preco" ? min : med;

  const round = (v: number) => Math.round(v * 100) / 100;

  return {
    validPrices: valid,
    discarded,
    count: n,
    mean: round(mean),
    median: round(med),
    min: round(min),
    max: round(max),
    stdDev: round(stdDev),
    coefficientOfVariation: round(cv),
    method,
    estimate: round(estimate),
    meetsMinimumThree: n >= 3,
    dispersionAlert: cv > 0.25,
  };
}
