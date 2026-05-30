import type { ContactProfileUpdate, ProductSummary } from "@hubadvisor/shared";

// Resultado da busca visual (cliente envia foto -> produtos parecidos)
export type VisualSearchResult = {
  // Atributos que a IA "leu" na foto da cliente (transparência/auditoria)
  atributosDetectados?: {
    styles: string[];
    occasions: string[];
    neckline: string;
    length: string;
    sleeveType: string;
    sheer: boolean;
    confidence: number;
  };
  produtos: ProductSummary[];
  erro?: string;
};

// Configuração do agente para um tenant
export type AgentConfig = {
  tenantId: string;
  persona: string;       // "Maya"
  tone: string;          // texto livre — entra no system prompt
  policies: Record<string, unknown>;
  storeName: string;
};

// Contexto da conversa atual
export type ConversationContext = {
  conversationId: string;
  contactId?: string;
  channel: "whatsapp" | "instagram" | "manual";
  contactProfile: {
    name?: string;
    height?: number;
    bust?: number;
    waist?: number;
    hips?: number;
    usualSize?: string;
    styles?: string[];
    occasions?: string[];
    avoid?: string[];
    favoriteColors?: string[];
  };
  recentMessages: Array<{ direction: "in" | "out"; text: string }>;
  // Resumos de conversas anteriores desta cliente (ADR-007) — memória de longo prazo.
  priorSummaries?: string[];
};

// Implementação concreta das tools — injetada pelo app (separação domínio × LLM)
export interface AgentToolImpl {
  buscarProduto(query: {
    estilo?: string[];
    ocasiao?: string[];
    tamanho?: string;
    cores?: string[];
    semDecote?: boolean;
    semTransparencia?: boolean;
    precoMax?: number;
  }): Promise<ProductSummary[]>;

  // Busca visual: analisa a(s) foto(s) enviada(s) pela cliente nesta mensagem
  // e devolve produtos parecidos. Opcional — implementada só no fluxo real
  // (mocks de eval/dry-run não recebem foto). Quando ausente, o agent
  // responde que não há foto para analisar.
  buscarPorFoto?(opts?: { precoMax?: number; tamanho?: string }): Promise<VisualSearchResult>;

  mostrarMidia(produtoId: string, tipo?: "foto" | "video"): Promise<{ enviado: boolean; descricao: string }>;

  verificarEstoque(sku: string): Promise<{ disponivel: number; reservado: number }>;

  consultarFrete(cep: string, sku: string): Promise<Array<{ servico: string; precoBRL: number; prazoDias: number }>>;

  atualizarPerfil(update: ContactProfileUpdate): Promise<void>;

  reservarItem(sku: string, ttlMinutos?: number): Promise<{ reservaId: string; expiraEm: string }>;

  criarPedido(input: {
    itens: Array<{ sku: string; quantidade: number }>;
    cep: string;
    servicoFrete?: string;
    // Fabricação (ADR-030 — Fase 4): entrega própria no lugar da transportadora.
    entregaPropria?: boolean;
    distanciaKm?: number;
  }): Promise<{ pedidoId: string; totalBRL: number; pixCopiaCola?: string; expiraEm?: string }>;

  statusPedido(pedidoId: string): Promise<unknown>;

  cancelarPedido(pedidoId: string, motivo: string): Promise<{ ok: boolean; motivo?: string }>;

  iniciarDevolucao(pedidoId: string, motivo: string): Promise<{ ok: boolean; motivo?: string; devolucaoId?: string }>;

  escalarParaHumano(motivo: string): Promise<{ escalado: boolean }>;

  // Fabricação (ADR-030 — Fase 4). Opcionais: só implementadas/oferecidas a
  // lojas com `productionEnabled`. Quando ausentes, o agent responde indisponível.
  consultarFicha?(sku: string): Promise<{
    produto: string;
    sobEncomenda: boolean;
    prazoDias: number | null;
    ingredientes: string[];
    semFicha: boolean;
    observacao?: string;
    erro?: string;
  }>;

  calcularEntregaPropria?(input: {
    distanceKm?: number;
    itens?: Array<{ sku: string; quantidade?: number }>;
  }): Promise<{
    disponivel: boolean;
    modal?: "moto" | "carro";
    modalSugerido?: "moto" | "carro";
    precoBRL?: number;
    distanceKm?: number;
    volume?: number;
    precisaDistancia?: boolean;
    faixas?: Array<{ modal: "moto" | "carro"; maxKm: number; priceBRL: number }>;
    foraDeFaixa?: boolean;
    observacao?: string;
  }>;
}

// Resultado de uma volta do agente
export type AgentTurn = {
  replyText?: string;
  toolCalls: Array<{ name: string; input: unknown; output: unknown }>;
  // Detecção de alucinação (ADR-014): flagga revisão se afirmou fato sem tool.
  review?: { flagged: boolean; reasons: string[] };
  llmUsage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    estimatedCostBRL: number;
  };
};
