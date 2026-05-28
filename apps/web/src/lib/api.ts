// Cliente HTTP do painel. Proxy /api → :3001 (ver vite.config.ts).
// MVP: tenant fixo. Quando houver auth (Fase 2.2), vem do contexto do usuário.

export const TENANT_SLUG = "thepop7";

async function get<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`/api${path}${sep}tenantSlug=${TENANT_SLUG}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantSlug: TENANT_SLUG, ...body }),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

export type Conversation = {
  id: string;
  channel: string;
  status: "active" | "handed_off" | "closed";
  contactName: string;
  lastMessage: string;
  lastMessageAt: string;
  handoffReason?: string | null;
  summary?: string | null;
};

export type Message = {
  id: string;
  direction: "in" | "out";
  type: string;
  content: string | null;
  llmModel?: string | null;
  llmCostBRL?: string | null;
  toolCalls?: Array<{ name: string; input: unknown; output: unknown }> | null;
  createdAt: string;
};

export const api = {
  listConversations: (status?: string) =>
    get<Conversation[]>(`/inbox/conversations${status ? `?status=${status}` : ""}`),
  listMessages: (conversationId: string) =>
    get<Message[]>(`/inbox/conversations/${conversationId}/messages`),
  reply: (conversationId: string, text: string) =>
    post<{ ok: boolean }>(`/inbox/conversations/${conversationId}/reply`, { text }),
  setStatus: (conversationId: string, status: string) =>
    post<{ ok: boolean; summary?: string }>(`/inbox/conversations/${conversationId}/status`, { status }),
  suggestReply: (conversationId: string) =>
    post<{ suggestion: string; repliedTo?: string; note?: string; cost: { estimatedCostBRL: number; model: string } | null }>(
      `/inbox/conversations/${conversationId}/suggest`, {}
    ),
  // Simula uma mensagem de cliente entrando (até WhatsApp/IG reais)
  simulateIncoming: (text: string, contactName: string, phone: string) =>
    post<{ reply: string | null; cost: { estimatedCostBRL: number; model: string } | null; aiPaused?: boolean }>(
      `/conversations/incoming`,
      { channel: "manual", contact: { name: contactName, phone }, text }
    ),
  listProducts: () => get<any[]>(`/catalog/products`).catch(() => []),
  cacheStats: () => fetch(`/api/admin/cache/stats`).then((r) => r.json()),
  getConfig: () => get<{ aiEnabled: boolean; monthlyAIBudgetBRL: number; autoApproveMaxBRL: number; retentionDays: number | null }>(`/admin/config`),
  setRetention: (retentionDays: number | null) => post<{ ok: boolean; retentionDays: number | null }>(`/admin/retention-config`, { retentionDays }),
  retentionPreview: () => get<{ enabled: boolean; retentionDays: number | null; conversasAfetadas?: number; mensagensAfetadas?: number }>(`/lgpd/retention/preview`),
  retentionRun: () => post<{ ok: boolean; mensagensAnonimizadas?: number; reason?: string }>(`/lgpd/retention/run`, {}),
  toggleAI: (enabled: boolean) => post<{ ok: boolean; aiEnabled: boolean }>(`/admin/ai-toggle`, { enabled }),
  setAutoApprove: (maxBRL: number) => post<{ ok: boolean; autoApproveMaxBRL: number }>(`/admin/auto-approve`, { maxBRL }),
  duplicateContacts: () => get<DuplicateGroup[]>(`/admin/identity/duplicates`),
  mergeContacts: (idA: string, idB: string) =>
    post<{ merged: boolean; primaryId: string; mergedId?: string }>(`/admin/identity/merge`, { idA, idB }),
  dailyMetrics: () => get<DailyMetrics>(`/metrics/daily`),
  reorder: () => get<ReorderSuggestion[]>(`/purchasing/reorder`),
  purchaseRequests: () => get<PurchaseRequest[]>(`/purchasing/requests`),
  purchaseCloseMessage: (requestId: string) =>
    get<{ ok: boolean; supplier?: string; totalBRL?: number; message?: string; error?: string }>(`/purchasing/requests/${requestId}/close-message`),
  suppliers: () => get<Supplier[]>(`/purchasing/suppliers`),
  listOrders: () => get<Order[]>(`/orders`),
  createSampleOrder: () => post<{ orderId: string }>(`/orders/sample`, {}),
  approveOrder: (orderId: string) =>
    post<{ ok: boolean; totalBRL?: number; pix?: { qrCode?: string }; reason?: string }>(`/orders/${orderId}/approve`, {}),
  simulateDelivery: (orderId: string) =>
    post<{ ok: boolean; transitions: string[] }>(`/post-sale/simulate-delivery`, { orderId }),
  triggerPostSale: (orderId: string, stage: "d1" | "d7" | "d14" | "d30") =>
    post<{ stage: string; message?: string; skipped?: boolean; reason?: string }>(
      `/post-sale/trigger`, { orderId, stage }
    ),
};

export type DuplicateContact = {
  id: string; name: string | null; phone: string | null;
  igHandle: string | null; email: string | null; cpf: string | null; createdAt: string;
};
export type DuplicateGroup = { sharedBy: string; confidence?: "alta" | "baixa"; contacts: DuplicateContact[] };

export type OrderTimelineEvent = { type: string; actor: string; at: string };

export type Order = {
  id: string;
  status: string;
  contactName: string;
  totalBRL: number;
  carrier: string | null;
  trackingCode: string | null;
  deliveredAt: string | null;
  deliveredTo: string | null;
  createdAt: string;
  returnable: boolean;
  pendingApproval?: boolean;
  items: Array<{ name: string; variantSku: string; quantity: number }>;
  timeline: OrderTimelineEvent[];
};

export type ReorderSuggestion = {
  productId: string; externalId: string; name: string;
  stock: number; soldLast30: number; reorderPoint: number; suggestedQty: number;
};

export type QuoteView = {
  supplier: string; totalBRL: number; leadTimeDays: number | null;
  paymentTerms: string | null; score: number | null; selected: boolean;
};

export type PurchaseRequest = {
  id: string; status: string; reason: string | null;
  items: Array<{ description: string; quantity: number }>;
  createdAt: string; quotes: QuoteView[];
};

export type Supplier = {
  id: string; name: string; contactPhone: string | null;
  relationshipScore: number; avgLeadTimeDays: number | null;
};

export type DailyMetrics = {
  conversationsToday: number;
  activeConversations: number;
  handedOff: number;
  totalConversations: number;
  resolvedByAIPct: number;
  aiMessagesToday: number;
  aiCostTodayBRL: number;
  aiCostTotalBRL: number;
  avgCostPerConversationBRL: number;
  modelDistribution: Record<string, number>;
  productsTotal: number;
  productsEnriched: number;
  financials: Financials;
  funnel: Funnel;
  budget: Budget;
};

export type Budget = {
  monthlyBudgetBRL: number;
  monthCostBRL: number;
  pctUsed: number;
  level: "ok" | "warning" | "over";
};

export type Funnel = {
  stages: Array<{ key: string; label: string; count: number; rateFromPrev?: number }>;
  ordersCanceled: number;
  overallConversionPct: number;
};

export type Financials = {
  realizedOrders: number;
  grossRevenueBRL: number;
  subtotalBRL: number;
  shippingBRL: number;
  cogsBRL: number;
  gatewayFeesBRL: number;
  netMarginBRL: number;
  netMarginPct: number;
  ordersMissingCost: number;
};
