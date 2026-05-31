// Perfil/classificação do cliente (ADR-036). Tags que dizem à IA COMO agir com
// cada pessoa. Algumas são "operacionais" (mudam o fluxo: bloquear/escalar); as
// demais ajustam o TOM da IA. Fonte única — usada no agent (prompt), na API e no web.

export type CustomerTagTone = "good" | "warn" | "danger" | "neutral";

export type CustomerTag = {
  key: string;
  label: string;
  tone: CustomerTagTone;
  // Operacional muda o fluxo: "block" = não atende (banido); "human" = escala já.
  operational?: "block" | "human";
  // Orientação injetada no system prompt (tags comportamentais).
  guidance?: string;
  desc: string; // ajuda pro operador no painel
};

export const CUSTOMER_TAGS: CustomerTag[] = [
  {
    key: "frequente", label: "Cliente frequente", tone: "good",
    desc: "Compra com recorrência — trate como VIP.",
    guidance: "Cliente fiel e valioso: agradeça a preferência, trate com um carinho extra e agilidade, e quando fizer sentido lembre dos benefícios de fidelidade (cashback).",
  },
  {
    key: "novo", label: "Cliente novo", tone: "neutral",
    desc: "Primeira vez — capriche na acolhida.",
    guidance: "Primeira compra/contato: seja especialmente acolhedora, explique com clareza como funciona (formas de pagamento, entrega/retirada) e capriche na primeira impressão.",
  },
  {
    key: "pechincheiro", label: "Pechincheiro", tone: "warn",
    desc: "Costuma pedir desconto — segure o preço.",
    guidance: "Tende a pedir desconto: mantenha o preço com firmeza e gentileza. NÃO invente promoções nem dê descontos por conta própria; em vez disso, destaque o valor do produto e os benefícios (cashback, parcelamento, brinde se houver na política).",
  },
  {
    key: "problematico", label: "Cliente problemático", tone: "warn",
    desc: "Histórico de atrito — cautela redobrada.",
    guidance: "Histórico de atrito: seja extra paciente, clara e objetiva; não prometa o que não pode cumprir; confirme tudo por escrito. Ao primeiro sinal de conflito ou exigência fora da política, escale para um atendente humano (escalar_para_humano).",
  },
  {
    key: "atencao_humana", label: "Requer atendimento humano", tone: "warn",
    operational: "human",
    desc: "Sempre encaminhar para uma pessoa.",
  },
  {
    key: "banido", label: "Banido", tone: "danger",
    operational: "block",
    desc: "Não deve ser atendido pela loja.",
  },
];

export const CUSTOMER_TAG_KEYS: string[] = CUSTOMER_TAGS.map((t) => t.key);

export function isCustomerTag(key: string): boolean {
  return CUSTOMER_TAG_KEYS.includes(key);
}

/** Gate operacional dominante: banido > humano > nenhum. */
export function operationalTag(tags: string[] | null | undefined): "block" | "human" | null {
  const set = new Set(tags ?? []);
  if (set.has("banido")) return "block";
  for (const t of CUSTOMER_TAGS) if (t.operational === "human" && set.has(t.key)) return "human";
  return null;
}

/** Orientações de TOM (comportamentais) das tags ativas, p/ o system prompt. */
export function guidanceForTags(tags: string[] | null | undefined): string[] {
  const set = new Set(tags ?? []);
  return CUSTOMER_TAGS.filter((t) => t.guidance && set.has(t.key)).map((t) => `- ${t.label}: ${t.guidance}`);
}
