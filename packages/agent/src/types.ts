import type { ContactProfileUpdate, ProductSummary } from "@thepop/shared";

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

  mostrarMidia(produtoId: string, tipo?: "foto" | "video"): Promise<{ enviado: boolean; descricao: string }>;

  verificarEstoque(sku: string): Promise<{ disponivel: number; reservado: number }>;

  consultarFrete(cep: string, sku: string): Promise<Array<{ servico: string; precoBRL: number; prazoDias: number }>>;

  atualizarPerfil(update: ContactProfileUpdate): Promise<void>;

  reservarItem(sku: string, ttlMinutos?: number): Promise<{ reservaId: string; expiraEm: string }>;

  criarPedido(input: {
    itens: Array<{ sku: string; quantidade: number }>;
    cep: string;
    servicoFrete?: string;
  }): Promise<{ pedidoId: string; totalBRL: number; pixCopiaCola?: string; expiraEm?: string }>;

  statusPedido(pedidoId: string): Promise<unknown>;

  cancelarPedido(pedidoId: string, motivo: string): Promise<{ ok: boolean; motivo?: string }>;

  iniciarDevolucao(pedidoId: string, motivo: string): Promise<{ ok: boolean; motivo?: string; devolucaoId?: string }>;

  escalarParaHumano(motivo: string): Promise<{ escalado: boolean }>;
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
