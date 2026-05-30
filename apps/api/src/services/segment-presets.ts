/* ============================================================================
   Presets de segmento (ADR-029, multi-segmento). Cada "tipo de negócio" traz:
   - paletteKey: cor de marca (o front mapeia para o acento; ver web/theme.ts)
   - styles/occasions: vocabulário de catálogo que alimenta a IA e a busca
   - aiVoice: tom de voz da IA (vira tenant.agentTone → entra no system prompt)
   Trocar de segmento na tela de Configurações prefila esses valores (editáveis).
   ============================================================================ */

export type SegmentPreset = {
  id: string;
  label: string;
  paletteKey: string;   // chave de cor (web/theme.ts conhece as paletas)
  styles: string[];
  occasions: string[];
  aiVoice: string;      // linguagem da IA específica do segmento
};

export const SEGMENT_PRESETS: SegmentPreset[] = [
  {
    id: "moda",
    label: "Moda & Vestuário",
    paletteKey: "rose",
    styles: ["moderno", "evangelico", "romantico", "festa", "fitness", "casual", "classico", "boho", "minimalista"],
    occasions: ["trabalho", "balada", "igreja", "dia-a-dia", "casamento", "praia", "eventos-formais"],
    aiVoice:
      "Consultora de moda acolhedora e próxima. Pergunta tamanho/medidas, estilo e ocasião; " +
      "sugere peças pelo caimento e pelo perfil da cliente; usa emojis com parcimônia.",
  },
  {
    id: "bolos",
    label: "Bolos & Confeitaria",
    paletteKey: "caramel",
    styles: ["aniversario", "casamento", "infantil", "tematico", "gourmet", "vegano", "fit", "vulcao", "naked-cake"],
    occasions: ["aniversario", "casamento", "cha-de-bebe", "cha-de-panela", "corporativo", "formatura", "datas-comemorativas"],
    aiVoice:
      "Atendente de confeitaria afetuosa e apetitosa. Vende bolo de forma sensorial: descreve " +
      "massas, recheios, coberturas e sabores de dar água na boca (ex.: 'massa amanteigada, " +
      "recheio cremoso de ninho com morango, cobertura de chantilly'). SEMPRE pergunta: (1) a DATA " +
      "que precisa do bolo, (2) a OCASIÃO/tema e (3) para QUANTAS PESSOAS — e sugere o tamanho/peso " +
      "ideal a partir disso. Oferece personalização (tema, cores, topo de bolo, escrita) e informa " +
      "prazo de encomenda e antecedência. Trata o cliente com carinho ('que delícia!', 'vai amar'), " +
      "valoriza o caseiro/artesanal e confirma sabores antes de fechar. Nunca promete entrega em " +
      "prazo que o sistema não confirma.",
  },
  {
    id: "farmacia",
    label: "Farmácia & Saúde",
    paletteKey: "emerald",
    styles: ["medicamento", "higiene", "dermocosmetico", "infantil", "suplemento", "primeiros-socorros"],
    occasions: ["dia-a-dia", "continuo", "emergencia", "bebe", "idoso"],
    aiVoice:
      "Atendente de farmácia objetivo, cordial e responsável. Ajuda a localizar produtos de higiene, " +
      "dermocosméticos e itens de venda livre. NUNCA prescreve, diagnostica nem indica medicamento de " +
      "tarja; para qualquer dúvida de saúde ou tarja, orienta procurar o farmacêutico/médico. Confere " +
      "disponibilidade e formas de retirada/entrega.",
  },
  {
    id: "pet",
    label: "Pet Shop",
    paletteKey: "gold",
    styles: ["racao", "petisco", "higiene", "brinquedo", "acessorio", "farmacia-pet"],
    occasions: ["filhote", "adulto", "senior", "banho-tosa", "presente"],
    aiVoice:
      "Atendente de pet shop animado e cuidadoso. Pergunta espécie, porte e idade do pet para indicar " +
      "ração e produtos certos; sugere petiscos e acessórios; trata o tutor com simpatia e carinho pelo bicho.",
  },
  {
    id: "generico",
    label: "Genérico / Outro",
    paletteKey: "navy",
    styles: [],
    occasions: [],
    aiVoice:
      "Atendente de loja prestativo, claro e cordial. Entende a necessidade do cliente, recomenda " +
      "produtos do catálogo e conduz a venda de forma natural.",
  },
];

export function getSegmentPreset(id: string): SegmentPreset | undefined {
  return SEGMENT_PRESETS.find((p) => p.id === id.toLowerCase());
}
