// Cliente HTTP do painel. Proxy /api → :3001 (ver vite.config.ts).
// MVP: tenant fixo. Quando houver auth (Fase 2.2), vem do contexto do usuário.

// ---- Auth (F2): token JWT + tenant da sessão no localStorage ----
const TOKEN_KEY = "hubadvisor_token";
const TENANT_KEY = "hubadvisor_tenant";
const BRAND_KEY = "hubadvisor_brand";
export const auth = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TENANT_KEY); localStorage.removeItem(BRAND_KEY); },
  isLoggedIn: () => !!localStorage.getItem(TOKEN_KEY),
};
/** Slug do tenant da sessão (default thepop7 — demo). */
export const tenantSlug = () => localStorage.getItem(TENANT_KEY) ?? "thepop7";
const setTenant = (slug: string) => localStorage.setItem(TENANT_KEY, slug);

/** Marca da loja da sessão (nome de exibição). */
export const brandName = () => localStorage.getItem(BRAND_KEY) ?? "";
const setBrand = (name: string) => { if (name) localStorage.setItem(BRAND_KEY, name); };

function authHeaders(): Record<string, string> {
  const t = auth.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// 401 → token inválido/expirado: limpa e manda pro login.
function on401() {
  auth.clear();
  window.dispatchEvent(new Event("hubadvisor:unauthorized"));
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

/** Baixa o arquivo único de etiquetas (CSV ou ZPL) do catálogo. */
export async function downloadLabels(format: "csv" | "zpl") {
  const res = await fetch(`/api/stock/labels?format=${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ tenantSlug: tenantSlug() }),
  });
  if (res.status === 401) { on401(); throw new Error("não autenticado"); }
  if (!res.ok) throw new Error(`etiquetas → ${res.status}`);
  const missing = res.headers.get("x-labels-missing");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `etiquetas.${format}`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  return { missing: Number(missing ?? 0) };
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

type AuthResult = {
  token: string; tenantSlug: string;
  tenant?: { slug: string; name: string };
  user: { id: string; name: string; email: string; role: string };
};

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
  if (data.tenant?.name) setBrand(data.tenant.name);
  return data.user;
}

/** Revalida o token e re-hidrata a marca (ex.: após refresh da página). */
export async function fetchMe(): Promise<{ tenant: { slug: string; name: string } | null } | null> {
  try {
    const me = await get<{ tenant: { slug: string; name: string } | null }>(`/auth/me`);
    if (me?.tenant?.name) setBrand(me.tenant.name);
    return me;
  } catch { return null; }
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
  if (data.tenant?.name) setBrand(data.tenant.name);
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
  getReceiving: (requestId: string) => get<ReceivingList>(`/purchasing/requests/${requestId}/receiving`),
  receivePurchase: (requestId: string, scanned: string[]) =>
    post<ReceiveResult>(`/purchasing/requests/${requestId}/receive`, { scanned }),
  suppliers: () => get<Supplier[]>(`/purchasing/suppliers`),
  listOrders: () => get<Order[]>(`/orders`),
  createSampleOrder: () => post<{ orderId: string }>(`/orders/sample`, {}),
  approveOrder: (orderId: string) =>
    post<{ ok: boolean; totalBRL?: number; pix?: { qrCode?: string }; reason?: string }>(`/orders/${orderId}/approve`, {}),
  simulateDelivery: (orderId: string) =>
    post<{ ok: boolean; transitions: string[] }>(`/post-sale/simulate-delivery`, { orderId }),
  issueNfe: (orderId: string) =>
    post<{ ok: boolean; number?: string; reason?: string; skipped?: boolean }>(`/orders/${orderId}/issue-nfe`, {}),
  triggerPostSale: (orderId: string, stage: "d1" | "d7" | "d14" | "d30") =>
    post<{ stage: string; message?: string; skipped?: boolean; reason?: string }>(
      `/post-sale/trigger`, { orderId, stage }
    ),
  // Integração Tray (ERP) — onboarding OAuth
  trayStatus: () => get<TrayStatus>(`/integrations/tray`),
  trayAuthorizeUrl: (apiAddress: string) =>
    get<{ url: string }>(`/integrations/tray/authorize?apiAddress=${encodeURIComponent(apiAddress)}`),
  trayRefresh: () => post<{ ok: boolean }>(`/integrations/tray/refresh`, {}),
  trayDisconnect: () => post<{ ok: boolean }>(`/integrations/tray/disconnect`, {}),
  // Integrações genéricas (MP, ME, WA, IG, CPlug, Anthropic)
  integrationStatus: (provider: string) => get<IntegrationStatus>(`/integrations/${provider}`),
  integrationAuthorize: (provider: string) => get<{ url: string }>(`/integrations/${provider}/authorize`),
  integrationRefresh: (provider: string) => post<{ ok: boolean }>(`/integrations/${provider}/refresh`, {}),
  integrationDisconnect: (provider: string) => post<{ ok: boolean }>(`/integrations/${provider}/disconnect`, {}),
  // Estoque / código de barras (F1/F2)
  backfillBarcodes: () => post<BackfillResult>(`/catalog/barcodes/backfill`, {}),
  stockTrace: (code: string) => get<StockTrace>(`/stock/trace?code=${encodeURIComponent(code)}`),
  // Atacado B2B (ADR-024)
  listWholesale: () => get<WholesaleProductRow[]>(`/catalog/wholesale`),
  setWholesale: (id: string, payload: { enabled: boolean; priceBRL?: number | null; minQty?: number }) =>
    post<{ ok: boolean }>(`/catalog/wholesale/${id}`, payload),
  // Picking / conferência de envio (F3)
  getPicking: (orderId: string) => get<PickingList>(`/orders/${orderId}/picking`),
  packOrder: (orderId: string, scanned: string[]) => post<PackResult>(`/orders/${orderId}/pack`, { scanned }),
  // Entradas/ajustes de estoque por scan (extras)
  stockReceive: (barcode: string, quantity: number, note?: string) =>
    post<{ ok: boolean; movementId: string }>(`/stock/receive`, { barcode, quantity, note }),
  stockAdjust: (barcode: string, type: "adjust_in" | "adjust_out", quantity: number, note?: string) =>
    post<{ ok: boolean; movementId: string }>(`/stock/adjust`, { barcode, type, quantity, note }),
  // Vínculo código ↔ imagem: foto da peça → códigos candidatos
  barcodesByPhoto: (photoUrls: string[]) => post<BarcodeByPhoto>(`/catalog/barcodes/by-photo`, { photoUrls }),

  // ── Mercadológica / rede de fornecedores (ADR-029) ──
  mercSuppliers: () => get<MercSupplier[]>(`/mercadologica/suppliers`),
  mercCreateSupplier: (payload: { name: string; document?: string; email?: string; phone?: string; uf?: string; municipio?: string; categories?: string[]; shareable?: boolean }) =>
    post<{ id: string }>(`/mercadologica/suppliers`, payload),
  mercAddOffer: (payload: { supplierId: string; item: string; sku?: string; priceBRL: number; unit?: string; validUntil?: string; notes?: string }) =>
    post<{ ok: boolean; offerId?: string }>(`/mercadologica/suppliers/offer`, payload),
  mercResearches: () => get<MercResearch[]>(`/mercadologica/researches`),
  mercCreateResearch: (payload: { title: string; items: Array<{ description: string; sku?: string; quantity?: number }>; method?: string; deadlineDays?: number }) =>
    post<{ id: string }>(`/mercadologica/researches`, payload),
  mercAddInvites: (researchId: string, invites: Array<{ supplierId?: string; supplierName: string; email?: string; phone?: string }>) =>
    post<{ ok: boolean; invites?: Array<{ token: string; supplierName: string }> }>(`/mercadologica/researches/${researchId}/invites`, { invites }),
  mercSendInvites: (researchId: string) =>
    post<{ ok: boolean; links?: Array<{ supplierName: string; link: string; sentVia: string }>; reason?: string }>(`/mercadologica/researches/${researchId}/send`, {}),
  mercConsolidation: (researchId: string) => get<MercConsolidation>(`/mercadologica/researches/${researchId}/consolidation`),
  mercCloseResearch: (researchId: string) => post<{ ok: boolean }>(`/mercadologica/researches/${researchId}/close`, {}),
  mercRecordQuote: (payload: { researchId?: string; supplierId?: string; supplierName: string; item: string; unitPriceBRL: number; quantity?: number }) =>
    post<{ ok: boolean; quoteId?: string }>(`/mercadologica/quotes`, payload),
  mercExtractQuote: (payload: { supplierName: string; text: string; researchId?: string; supplierId?: string }) =>
    post<{ ok: boolean; count?: number; reason?: string }>(`/mercadologica/quotes/extract`, payload),
  mercPendingQuotes: () => get<MercPendingQuote[]>(`/mercadologica/quotes/pending`),
  mercApproveQuote: (id: string) => post<{ ok: boolean }>(`/mercadologica/quotes/${id}/approve`, {}),
  mercRejectQuote: (id: string, reason?: string) => post<{ ok: boolean }>(`/mercadologica/quotes/${id}/reject`, { reason }),
  mercPanel: () => get<MercPanel>(`/mercadologica/panel`),
};

// ── Cotação pública (sem auth) — usada na tela /cotacao/:token ──
export async function fetchPublicInvite(token: string) {
  const res = await fetch(`/api/cotacao-publica/${token}`);
  if (!res.ok) throw new Error("convite não encontrado");
  return res.json() as Promise<PublicInvite>;
}
export async function submitPublicQuote(token: string, body: { item: string; unitPriceBRL: number; quantity?: number; details?: Record<string, unknown> }) {
  const res = await fetch(`/api/cotacao-publica/${token}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("não foi possível enviar a cotação");
  return res.json() as Promise<{ ok: boolean }>;
}

export type MercSupplier = {
  id: string; name: string; document: string | null; email: string | null; phone: string | null;
  uf: string | null; municipio: string | null; shareable: boolean; categories: string[];
  relationshipScore: number; avgLeadTimeDays: number | null;
  offers: Array<{ id: string; item: string; sku: string | null; priceBRL: number; unit: string | null; validUntil: string | null; notes: string | null }>;
};
export type MercResearch = {
  id: string; title: string; items: Array<{ description: string; sku?: string; quantity?: number }>;
  method: string; deadlineDays: number; status: string; createdAt: string;
  invitesTotal: number; invitesResponded: number; quotesCount: number;
};
export type MercConsolidationItem = {
  item: string;
  quotes: Array<{ supplierName: string; unitPriceBRL: number; origin: string; isCheapest: boolean }>;
  consolidation: {
    validPrices: number[]; discarded: Array<{ value: number; reason: string }>; count: number;
    mean: number; median: number; min: number; max: number; stdDev: number; coefficientOfVariation: number;
    method: string; estimate: number; meetsMinimumThree: boolean; dispersionAlert: boolean;
  };
};
export type MercConsolidation = { researchId: string; title: string; method: string; status: string; items: MercConsolidationItem[] };
export type MercPendingQuote = { id: string; supplierName: string; item: string; unitPriceBRL: number; quantity: number; origin: string; details: unknown; createdAt: string };
export type MercPanel = { researchesByStatus: Record<string, number>; invitesByState: Record<string, number>; pendingQuotes: number; suppliers: number };
export type PublicInvite = { supplierName: string; storeName: string; title: string; items: Array<{ description: string; sku?: string; quantity?: number }>; deadlineDays: number; alreadyResponded: boolean };

export type BarcodeByPhoto = {
  ok: boolean;
  atributosDetectados?: Record<string, unknown>;
  candidatos: Array<{
    productId: string; name: string; priceBRL: number; score: number | null; mainPhoto: string | null;
    variantes: Array<{ sku: string; color?: string; size?: string; barcode: string | null }>;
  }>;
};

export type WholesaleProductRow = {
  id: string; externalId: string; name: string; priceBRL: number; stock: number;
  wholesaleEnabled: boolean; wholesalePriceBRL: number | null; wholesaleMinQty: number;
};

export type PickingItem = { variantSku: string; description: string; quantity: number; barcode: string | null };
export type PickingList = { orderId: string; items: PickingItem[] };
export type PackResult = {
  ok: boolean; complete: boolean;
  items: Array<{ variantSku: string; barcode: string; expected: number; conferred: number; missing: number }>;
  extras: Array<{ barcode: string; count: number }>;
};

export type BackfillResult = { produtos: number; variantes: number; jaTinham: number; gerados: number; lookupSincronizado: number };

export type StockMovement = {
  id: string; type: "purchase_in" | "sale_out" | "return_in" | "adjust_in" | "adjust_out";
  quantity: number; refType: string | null; refId: string | null; note: string | null; actor: string; at: string;
};
export type StockTrace = {
  barcode: string; productName: string; variantSku: string; photo?: string | null;
  saldoRazao: number; porTipo: Record<string, number>; movimentos: StockMovement[];
};

export type IntegrationStatus = {
  provider: string;
  connected: boolean;
  status: string;
  note?: string;
  appConfigured?: boolean;
  envToken?: boolean;
  lastError?: string | null;
};

export type TrayStatus = {
  provider: "tray";
  connected: boolean;
  status: string;
  storeId: string | null;
  apiAddress: string | null;
  connectedAt: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  appConfigured: boolean;
  lastError: string | null;
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
  nfeNumber?: string | null;
  nfePdfUrl?: string | null;
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

export type ReceivingItem = { sku: string | null; description: string; quantity: number; barcode: string | null };
export type ReceivingList = { requestId: string; status: string; items: ReceivingItem[] };
export type ReceiveResult = {
  ok: boolean; complete: boolean; recorded: number;
  items: Array<{ variantSku: string; barcode: string; expected: number; conferred: number; missing: number }>;
  extras: Array<{ barcode: string; count: number }>;
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
  nfePending: number;
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
  shippingCostBRL: number;
  shippingResultBRL: number;
  cogsBRL: number;
  gatewayFeesBRL: number;
  netMarginBRL: number;
  netMarginPct: number;
  ordersMissingCost: number;
  ordersMissingShippingCost: number;
};
