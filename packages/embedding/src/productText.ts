/* ============================================================
   productText — gera o texto que será embeddado pra busca semântica.
   Concatena os atributos enriquecidos (estilo, ocasião, decote, etc.)
   de forma que a embedding capture intenção da cliente, não só nome.

   Por exemplo, um "Vestido Floral Manga 3/4" com estilos
   [romantico, festa] e ocasiao [casamento, trabalho] vira:

     "Vestido Floral Manga 3/4
      Estilos: romantico, festa.
      Ocasiões: casamento, trabalho.
      Decote: médio. Comprimento: médio. Sem transparência.
      Cores: Azul, Rosa."

   Esse texto é melhor que só o nome porque a cliente busca por
   intenção ("vestido pra casamento") e o embedding bate.
   ============================================================ */

export type ProductForEmbedding = {
  name: string;
  description?: string | null;
  styles?: string[];
  occasions?: string[];
  neckline?: string | null;
  sheer?: boolean | null;
  length?: string | null;
  sleeveType?: string | null;
  variants?: Array<{ color?: string; size?: string }>;
};

export function productEmbeddingText(p: ProductForEmbedding): string {
  const parts: string[] = [];

  parts.push(p.name);
  if (p.description) parts.push(p.description);

  if (p.styles?.length)    parts.push(`Estilos: ${p.styles.join(", ")}.`);
  if (p.occasions?.length) parts.push(`Ocasiões: ${p.occasions.join(", ")}.`);

  const physical: string[] = [];
  if (p.neckline)   physical.push(`decote ${p.neckline}`);
  if (p.length)     physical.push(`comprimento ${p.length}`);
  if (p.sleeveType) physical.push(`manga ${p.sleeveType}`);
  if (p.sheer != null) physical.push(p.sheer ? "com transparência" : "sem transparência");
  if (physical.length) parts.push(physical.join(", ") + ".");

  const colors = Array.from(new Set((p.variants ?? []).map((v) => v.color).filter(Boolean)));
  if (colors.length) parts.push(`Cores: ${colors.join(", ")}.`);

  const sizes = Array.from(new Set((p.variants ?? []).map((v) => v.size).filter(Boolean)));
  if (sizes.length) parts.push(`Tamanhos: ${sizes.join(", ")}.`);

  return parts.join("\n");
}
