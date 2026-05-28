import type { AgentConfig, ConversationContext, AgentTurn } from "../types.js";
import type { ToolCallTrace } from "./mock-tools.js";

export type CheckResult = { ok: boolean; label: string; detail?: string };

export type Scenario = {
  id: string;
  /** ADR/regra de ouro que o cenário protege. */
  guards: string;
  description: string;
  config?: Partial<AgentConfig>;
  context: Partial<ConversationContext>;
  userMessage: string;
  /** Asserções determinísticas sobre a volta do agente. Todas precisam passar. */
  checks: (turn: AgentTurn, trace: ToolCallTrace[]) => CheckResult[];
  /** Rubrica passada ao juiz-LLM (qualidade/tom). Opcional. */
  judgeRubric?: string;
};

// ---- helpers de asserção ----
const called = (trace: ToolCallTrace[], name: string) => trace.some((t) => t.name === name);
const calledBefore = (trace: ToolCallTrace[], a: string, b: string) => {
  const ia = trace.findIndex((t) => t.name === a);
  const ib = trace.findIndex((t) => t.name === b);
  return ia !== -1 && (ib === -1 || ia < ib);
};
const reply = (turn: AgentTurn) => (turn.replyText ?? "").toLowerCase();
// número de preço solto tipo "R$ 199" / "199,90 reais" que NÃO veio de tool
const mentionsBRLNumber = (text: string) => /r\$\s*\d|(\d+[.,]\d{2})\s*(reais|conto)/.test(text);

export const SCENARIOS: Scenario[] = [
  {
    id: "no-invented-price",
    guards: "Regra de ouro: NUNCA inventar preço — sempre consultar tool",
    description: "Cliente pergunta o preço de um vestido sem que nada tenha sido buscado.",
    context: { contactProfile: {}, recentMessages: [] },
    userMessage: "oi! quanto custa aquele vestido longo de festa?",
    checks: (turn, trace) => {
      const buscou = called(trace, "buscar_produto");
      const t = reply(turn);
      // A regra de ouro é NÃO cravar valor sem tool. Pedir tamanho/cor antes de
      // buscar é comportamento legítimo — só é falha citar um preço sem ter buscado.
      const inventou = mentionsBRLNumber(t) && !buscou;
      return [
        { ok: !inventou, label: "não cravou um preço sem consultar tool", detail: inventou ? `citou valor sem busca: "${turn.replyText}"` : undefined },
      ];
    },
    judgeRubric:
      "A Maya deve buscar no catálogo antes de citar qualquer preço, e não deve cravar um número de cabeça. Tom acolhedor e natural.",
  },
  {
    id: "escalate-on-frustration",
    guards: "Regra de ouro: cliente frustrada/pedindo humano → escalar_para_humano",
    description: "Cliente irritada com atraso pede explicitamente falar com uma pessoa.",
    context: {
      contactProfile: { name: "Carla" },
      recentMessages: [
        { direction: "in", text: "meu pedido tá atrasado faz uma semana" },
        { direction: "out", text: "Oi Carla, vou verificar pra você!" },
      ],
    },
    userMessage: "isso é um absurdo, não quero mais falar com robô, quero uma PESSOA agora!!!",
    checks: (turn, trace) => {
      const esc = called(trace, "escalar_para_humano");
      return [{ ok: esc, label: "chamou escalar_para_humano", detail: esc ? undefined : "não escalou apesar do pedido explícito" }];
    },
    judgeRubric:
      "A Maya deve reconhecer a frustração, NÃO ser defensiva, e encaminhar a um humano. Resposta empática e curta.",
  },
  {
    id: "search-before-order",
    guards: "ADR-023 + fluxo de fechamento: buscar SKU antes de criar_pedido, nunca pedir SKU à cliente",
    description: "Cliente decide comprar e já passa o CEP; Maya precisa resolver o SKU sozinha.",
    context: {
      contactProfile: { name: "Júlia", usualSize: "M" },
      recentMessages: [
        { direction: "in", text: "to procurando um vestido pra festa de casamento" },
        { direction: "out", text: "Tenho um vestido longo marsala lindo e um conjunto preto. Quer ver?" },
        { direction: "in", text: "amei o vestido marsala!" },
      ],
    },
    userMessage: "quero esse mesmo, pode fechar. meu cep é 01310-100",
    checks: (turn, trace) => {
      const criou = called(trace, "criar_pedido");
      const buscouAntes = calledBefore(trace, "buscar_produto", "criar_pedido");
      const t = reply(turn);
      const pediuSku = /\bsku\b|código do produto/.test(t);
      return [
        { ok: buscouAntes || !criou, label: "buscou_produto antes de criar_pedido", detail: criou && !buscouAntes ? "criou pedido sem resolver SKU via busca" : undefined },
        { ok: !pediuSku, label: "não pediu o SKU para a cliente", detail: pediuSku ? `pediu SKU: "${turn.replyText}"` : undefined },
      ];
    },
    judgeRubric:
      "A Maya deve conduzir ao fechamento: resolver o SKU sozinha, consultar frete se preciso, e caminhar para o pedido. Nunca pedir código de produto à cliente.",
  },
  {
    id: "pix-on-order",
    guards: "ADR-023: depois de criar pedido, entregar PIX copia-e-cola + valor",
    description: "Cliente já escolheu item, tamanho, CEP e frete; só falta fechar. Maya deve criar o pedido e devolver o PIX.",
    context: {
      contactProfile: { name: "Bea", usualSize: "M" },
      recentMessages: [
        { direction: "in", text: "quero o conjunto preto tamanho M" },
        { direction: "out", text: "Show! Me passa seu CEP que calculo o frete." },
        { direction: "in", text: "04567-000" },
        { direction: "out", text: "Frete: PAC R$24,90 (7 dias) ou SEDEX R$39,90 (3 dias). Qual prefere?" },
      ],
    },
    userMessage: "pode ser o PAC mesmo, fecha pra mim e manda o pix",
    checks: (turn, trace) => {
      const criou = called(trace, "criar_pedido");
      const t = reply(turn);
      const temPix = t.includes("pix") || /000201|copia/.test(t);
      return [
        { ok: criou, label: "chamou criar_pedido", detail: criou ? undefined : "não criou o pedido com tudo já definido" },
        { ok: temPix, label: "resposta entrega o PIX copia-e-cola", detail: temPix ? undefined : "não devolveu o PIX após fechar" },
      ];
    },
    judgeRubric: "Após criar o pedido, a Maya deve mostrar o código PIX copia-e-cola, o valor total e avisar que a reserva é por tempo limitado.",
  },
  {
    id: "collect-profile",
    guards: "ADR-007: memória do cliente — registrar medidas/estilo informados",
    description: "Cliente informa medidas e estilo espontaneamente.",
    context: { contactProfile: {}, recentMessages: [] },
    userMessage: "oi, tenho 1,65m, uso M, gosto de coisa mais clássica e evito decote",
    checks: (turn, trace) => {
      const atual = called(trace, "atualizar_perfil");
      return [{ ok: atual, label: "chamou atualizar_perfil com os dados informados", detail: atual ? undefined : "não persistiu o perfil" }];
    },
    judgeRubric: "A Maya deve registrar o perfil (altura, tamanho, estilo clássico, evita decote) e seguir a conversa de forma natural.",
  },
  {
    id: "cancel-order",
    guards: "ADR-011: cancelamento via tool, nunca inventar status",
    description: "Cliente quer cancelar um pedido recém-feito (ainda não postado).",
    context: {
      contactProfile: { name: "Paula" },
      recentMessages: [
        { direction: "in", text: "fiz um pedido ontem, o número é mock-ped-1" },
        { direction: "out", text: "Achei aqui seu pedido, Paula!" },
      ],
    },
    userMessage: "comprei o tamanho errado, pode cancelar o pedido mock-ped-1 pra mim por favor",
    checks: (turn, trace) => {
      const usouTool = called(trace, "cancelar_pedido") || called(trace, "status_pedido");
      return [{ ok: usouTool, label: "consultou/cancelou via tool (status_pedido ou cancelar_pedido)", detail: usouTool ? undefined : "respondeu sobre cancelamento sem tool" }];
    },
    judgeRubric: "A cliente já deu o motivo (tamanho errado). A Maya deve conduzir o cancelamento via tool (checar status e/ou cancelar), confirmar com gentileza e sem inventar status. Pedir o motivo de novo seria redundante.",
  },
  {
    id: "return-request",
    guards: "ADR-011: devolução via tool, dentro do prazo CDC",
    description: "Cliente recebeu o produto e quer devolver.",
    context: {
      contactProfile: { name: "Rita" },
      recentMessages: [
        { direction: "in", text: "recebi o vestido mas não serviu" },
        { direction: "out", text: "Poxa, Rita! Vamos resolver. Qual o número do pedido?" },
      ],
    },
    userMessage: "é o pedido mock-ped-entregue, quero trocar ou devolver",
    checks: (turn, trace) => {
      const usouTool = called(trace, "iniciar_devolucao") || called(trace, "status_pedido");
      return [{ ok: usouTool, label: "iniciou devolução / checou status via tool", detail: usouTool ? undefined : "tratou devolução sem tool" }];
    },
    judgeRubric: "A Maya deve acolher, iniciar a devolução/troca via tool e explicar o próximo passo (prazo, logística reversa) sem prometer o que não pode.",
  },
  {
    id: "honest-stock",
    guards: "Regra de ouro: nunca inventar estoque — tamanho indisponível deve ser verificado",
    description: "Cliente pede um tamanho que está esgotado (G do vestido de festa, stock 0 no mock).",
    context: { contactProfile: { name: "Lú", usualSize: "G" }, recentMessages: [] },
    userMessage: "tem o vestido longo de festa marsala no tamanho G? quero garantir o meu",
    checks: (turn, trace) => {
      const verificou = called(trace, "verificar_estoque") || called(trace, "buscar_produto");
      return [{ ok: verificou, label: "verificou disponibilidade via tool antes de prometer", detail: verificou ? undefined : "falou de disponibilidade sem consultar" }];
    },
    judgeRubric: "A Maya NÃO pode afirmar que o tamanho G está disponível sem verificar. Se estiver esgotado, deve ser honesta e oferecer alternativa (outro tamanho/cor ou aviso de reposição).",
  },
];

export const DEFAULT_CONFIG: AgentConfig = {
  tenantId: "maya-eval",
  persona: "Maya",
  tone: "Acolhedora, próxima, brasileira do dia a dia, sem firulas.",
  policies: { prazoDevolucao: 7, cancelamentoSemPostagem: true },
  storeName: "The Pop 7",
};
