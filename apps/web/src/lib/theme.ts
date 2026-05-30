// Identidade de marca por loja. Cada tenant recebe um acento de cor próprio
// (determinístico pelo slug), dentro de uma paleta curada — sofisticada e
// adequada a moda feminina de alto estilo. O acento vira a cor `--primary`.

type Accent = { h: number; s: number; l: number };

// Paleta curada — todos os tons são profundos o bastante para texto branco.
const PALETTE: Record<string, Accent> = {
  rose:      { h: 345, s: 64, l: 52 }, // The Pop 7 — assinatura
  burgundy:  { h: 344, s: 52, l: 38 },
  plum:      { h: 295, s: 32, l: 44 },
  mauve:     { h: 330, s: 30, l: 48 },
  terracotta:{ h: 14,  s: 58, l: 50 },
  rust:      { h: 20,  s: 60, l: 47 },
  gold:      { h: 36,  s: 54, l: 44 },
  emerald:   { h: 158, s: 42, l: 36 },
  teal:      { h: 186, s: 50, l: 35 },
  navy:      { h: 222, s: 50, l: 44 },
  indigo:    { h: 245, s: 42, l: 50 },
  noir:      { h: 240, s: 12, l: 22 },
  caramel:   { h: 26,  s: 58, l: 44 }, // bolos/confeitaria — caramelo apetitoso
};

// Cor por TIPO DE NEGÓCIO (segmento). Tem prioridade sobre o slug da loja.
const SEGMENT_ACCENT: Record<string, keyof typeof PALETTE> = {
  moda: "rose",
  bolos: "caramel",
  farmacia: "emerald",
  pet: "gold",
  generico: "navy",
};

// Lojas com marca fixa conhecida.
const PINNED: Record<string, keyof typeof PALETTE> = {
  hubadvisor: "rose",
};

// Ordem de rotação para slugs sem pin (exclui rose, reservada à The Pop 7).
const ROTATION: (keyof typeof PALETTE)[] = [
  "plum", "navy", "terracotta", "emerald", "burgundy", "teal", "gold", "mauve", "indigo", "rust", "noir",
];

function hashSlug(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

export function accentForSlug(slug: string): Accent {
  const s = (slug || "thepop7").toLowerCase();
  if (PINNED[s]) return PALETTE[PINNED[s]];
  const key = ROTATION[hashSlug(s) % ROTATION.length];
  return PALETTE[key];
}

/** Acento por tipo de negócio (segmento), com fallback pro slug. */
export function accentForSegment(segment: string | undefined, slug: string): Accent {
  const seg = (segment ?? "").toLowerCase();
  const key = SEGMENT_ACCENT[seg];
  if (key) return PALETTE[key];
  return accentForSlug(slug);
}

/** Aplica o acento da marca (por segmento; senão por slug) como variáveis CSS. */
export function applyBrandTheme(slug: string, segment?: string) {
  const a = accentForSegment(segment, slug);
  const root = document.documentElement.style;
  const value = `${a.h} ${a.s}% ${a.l}%`;
  // tom levemente mais escuro pro hover/realce
  const strong = `${a.h} ${a.s}% ${Math.max(0, a.l - 8)}%`;
  // tom muito suave pra fundos/realces sutis
  const soft = `${a.h} ${Math.round(a.s * 0.5)}% 95%`;
  root.setProperty("--primary", value);
  root.setProperty("--accent", value);
  root.setProperty("--ring", value);
  root.setProperty("--primary-strong", strong);
  root.setProperty("--accent-soft", soft);
}
