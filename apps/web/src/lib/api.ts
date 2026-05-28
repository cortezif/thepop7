// Cliente HTTP do painel. Proxy /api → :3001 (ver vite.config.ts).
// MVP: tenant fixo. Quando houver auth (Fase 2.2), vem do contexto do usuário.

// ---- Auth (F2): token JWT + tenant da sessão no localStorage ----
const TOKEN_KEY = "thepop7_token";
const TENANT_KEY = "thepop7_tenant";
export const auth = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TENANT_KEY); },
  isLoggedIn: () => !!localStorage.getItem(TOKEN_KEY),
};
/** Slug do tenant da sessão (default thepop7 — demo). */
export const tenantSlug = () => localStorage.getItem(TENANT_KEY) ?? "thepop7";
const setTenant = (slug: string) => localStorage.setItem(TENANT_KEY, slug);

function authHeaders(): Record<string, string> {
  const t = auth.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// 401 → token inválido/expirado: limpa e manda pro login.
function on401() {
  auth.clear();
  window.dispatchEvent(new Event("thepop7:unauthorized"));
}

async function get<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`/api${path}${sep}tenantSlug=${tenantSlug()}`, { headers: authHeaders() });
  if (res.status === 401) { on401(); throw new Error("não autenticado"); }
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ tenantSlug: tenantSlug(), ...body }),
  });
  if (res.status === 401) { on401(); throw new Error("não autenticado"); }
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

/** Baixa o CSV de pedidos com o header de auth (link <a> não manda token). */
export async function downloadOrdersCsv() {
  const res = await fetch(`/api/orders/export.csv?tenantSlug=${tenantSlug()}`, { headers: authHeaders() });
  if (res.status === 401) { on401(); throw new Error("não autenticado"); }
  if (!res.ok) throw new Error(`export → ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `pedidos-${tenantSlug()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

type AuthResult = { token: string; tenantSlug: string; user: { id: string; name: string; email: string; role: string } };

/** Login: guarda token + tenant da sessão. `slug` = identificador da loja. */
export async function login(email: string, password: string, slug: string) {
  const res = await fetch(`/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantSlug: slug.trim().toLowerCase(), email, password }),
  });
  if (!res.ok) throw new Error("E-mail, senha ou loja inválidos");
  const data = (await res.json()) as AuthResult;
  auth.set(data.token); setTenant(data.tenantSlug);
  return data.user;
}

/** Cadastro self-service de loja: cria tenant + owner e já loga. */
export async function signup(input: { storeName: string; slug: string; name: string; email: string; password: string }) {
  const res = await fetch(`/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.fieldErrors ? JSON.stringify(err.error.fieldErrors) : (err?.error ?? "Não foi possível criar a loja"));
  }
  const data = (await res.json()) as AuthResult;
  auth.set(data.token); setTenant(data.tenantSlug);
  return data.user;
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
  tags?: string[];
  assignedToId?: string | null;
  assignedToName?: string | null;
};

export type ConversationNote = { id: string; text: string; authorName?: string | null; createdAt: string };

export type Message = {
  id: string;
  direction: "in" | "out";
  type: string;
  content: string | null;
  llmModel?: string | null;
  llmCostBRL?: string | null;
  toolCalls?: Array<{ name: string; input: unknown; output: unknown }> | null;
  reviewFlagged?: boolean;
  reviewReasons?: string[];
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
  setTags: (conversationId: string, tags: string[]) =>
    post<{ ok: boolean; tags: string[] }>(`/inbox/conversations/${conversationId}/tags`, { tags }),
  listNotes: (conversationId: string) =>
    get<ConversationNote[]>(`/inbox/conversations/${conversationId}/notes`),
  addNote: (conversationId: string, text: string) =>
    post<ConversationNote>(`/inbox/conversations/${conversationId}/notes`, { text }),
  assignToMe: (conversationId: string, unassign?: boolean) =>
    post<{ ok: boolean; assignedToName?: string | null }>(`/inbox/conversations/${conversationId}/assign`, { unassign }),
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
  cacheStats: () => get<any>(`/admin/cache/stats`),
  getConfig: () => get<{ aiEnabled: boolean; monthlyAIBudgetBRL: number; autoApproveMaxBRL: number; retentionDays: number | null; orderRetentionDays: number | null }>(`/admin/config`),
  setRetention: (payload: { retentionDays?: number | null; orderRetentionDays?: number | null }) =>
    post<{ ok: boolean; retentionDays?: number | null; orderRetentionDays?: number | null }>(`/admin/retention-config`, payload),
  retentionPreview: () => get<{ enabled: boolean; retentionDays: number | null; orderRetentionDays: number | null; mensagensAfetadas?: number; pedidosAfetados?: number }>(`/lgpd/retention/preview`),
  retentionRun: () => post<{ ok: boolean; mensagensAnonimizadas?: number; pedidosAnonimizados?: number; reason?: string }>(`/lgpd/retention/run`, {}),
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
  flaggedForReview: number;
  financials: Financials;
  funnel: Funnel;
  budget: Budget;
  nps: { geral: NpsStat; produto: NpsStat; atendimento: NpsStat };
};

export type NpsStat = { score: number; responses: number; promotores: number; neutros: number; detratores: number };

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
