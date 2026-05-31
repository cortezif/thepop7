// Cliente HTTP do painel. Proxy /api → :3001 (ver vite.config.ts).
// MVP: tenant fixo. Quando houver auth (Fase 2.2), vem do contexto do usuário.

// ---- Auth (F2): token JWT + tenant da sessão no localStorage ----
const TOKEN_KEY = "hubadvisor_token";
const TENANT_KEY = "hubadvisor_tenant";
const BRAND_KEY = "hubadvisor_brand";
const ROLE_KEY = "hubadvisor_role";
export const auth = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TENANT_KEY); localStorage.removeItem(BRAND_KEY); localStorage.removeItem(ROLE_KEY); localStorage.removeItem("hubadvisor_segment"); },
  isLoggedIn: () => !!localStorage.getItem(TOKEN_KEY),
};

/** Papel do usuário da sessão (owner | admin | operator). */
export type Role = "owner" | "admin" | "operator";
export const currentRole = (): Role => (localStorage.getItem(ROLE_KEY) as Role) ?? "operator";
const setRole = (r?: string | null) => { if (r) localStorage.setItem(ROLE_KEY, r); };
/** True se o usuário pode gerenciar equipe/config (owner ou admin). */
export const canManage = (): boolean => currentRole() === "owner" || currentRole() === "admin";
/** Slug do tenant da sessão (default thepop7 — demo). */
export const tenantSlug = () => localStorage.getItem(TENANT_KEY) ?? "thepop7";
const setTenant = (slug: string) => localStorage.setItem(TENANT_KEY, slug);

/** Marca da loja da sessão (nome de exibição). */
export const brandName = () => localStorage.getItem(BRAND_KEY) ?? "";
const setBrand = (name: string) => { if (name) localStorage.setItem(BRAND_KEY, name); };

/** Segmento da loja da sessão (p/ aplicar a cor da marca já no load, sem flash). */
const SEGMENT_KEY = "hubadvisor_segment";
export const storedSegment = (): string | undefined => localStorage.getItem(SEGMENT_KEY) ?? undefined;
export const setStoredSegment = (s?: string | null) => { if (s) localStorage.setItem(SEGMENT_KEY, s); };

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
  if (!res.ok) { const e = await res.json().catch(() => null); throw new Error(e?.error?.formErrors?.join?.(" ") || (typeof e?.error === "string" ? e.error : `POST ${path} → ${res.status}`)); }
  return res.json();
}

async function put<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ tenantSlug: tenantSlug(), ...body }),
  });
  if (res.status === 401) { on401(); throw new Error("não autenticado"); }
  if (!res.ok) { const e = await res.json().catch(() => null); throw new Error(typeof e?.error === "string" ? e.error : `PUT ${path} → ${res.status}`); }
  return res.json();
}

async function patch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ tenantSlug: tenantSlug(), ...body }),
  });
  if (res.status === 401) { on401(); throw new Error("não autenticado"); }
  if (!res.ok) { const e = await res.json().catch(() => null); throw new Error(typeof e?.error === "string" ? e.error : `PATCH ${path} → ${res.status}`); }
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`/api${path}${sep}tenantSlug=${tenantSlug()}`, { method: "DELETE", headers: authHeaders() });
  if (res.status === 401) { on401(); throw new Error("não autenticado"); }
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
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

export type LoginResult =
  | { kind: "ok"; user: AuthResult["user"] }
  | { kind: "choose"; tenants: Array<{ slug: string; name: string }> };

/**
 * Login por e-mail. Resolve a loja automaticamente; só quando o mesmo
 * e-mail+senha existe em mais de uma loja retorna `kind: "choose"` para o
 * usuário selecionar (reenviar com `slug`).
 */
export async function login(email: string, password: string, slug?: string): Promise<LoginResult> {
  const res = await fetch(`/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password, ...(slug ? { tenantSlug: slug.trim().toLowerCase() } : {}) }),
  });
  if (!res.ok) throw new Error("E-mail ou senha inválidos");
  const data = (await res.json()) as
    | AuthResult
    | { needsTenantSelection: true; tenants: Array<{ slug: string; name: string }> };
  if ("needsTenantSelection" in data) return { kind: "choose", tenants: data.tenants };
  auth.set(data.token); setTenant(data.tenantSlug);
  if (data.tenant?.name) setBrand(data.tenant.name);
  setRole(data.user.role);
  return { kind: "ok", user: data.user };
}

/** Revalida o token e re-hidrata a marca + papel (ex.: após refresh da página). */
export async function fetchMe(): Promise<{ role?: string; tenant: { slug: string; name: string } | null } | null> {
  try {
    const me = await get<{ role?: string; tenant: { slug: string; name: string } | null }>(`/auth/me`);
    if (me?.tenant?.name) setBrand(me.tenant.name);
    if (me?.role) setRole(me.role);
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
  setRole(data.user.role);
  return data.user;
}

// ── Gestão de equipe (owner/admin) + conta pessoal ──
export type TeamUser = { id: string; name: string; email: string; role: Role; createdAt: string };
export const team = {
  list: () => get<TeamUser[]>(`/users`),
  create: (input: { name: string; email: string; role: Role; password: string }) =>
    post<TeamUser>(`/users`, input),
  update: (id: string, input: { name?: string; role?: Role }) =>
    patch<TeamUser>(`/users/${id}`, input),
  resetPassword: (id: string, password: string) =>
    post<{ ok: boolean }>(`/users/${id}/password`, { password }),
  remove: (id: string) => del<{ ok: boolean }>(`/users/${id}`),
  changeOwnPassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: boolean }>(`/auth/change-password`, { currentPassword, newPassword }),
};

// ── Painel da plataforma (chave própria x-platform-key, não usa o JWT) ──
export type PlatformTenant = {
  id: string; slug: string; name: string; status: "active" | "suspended" | "trial";
  segment: string; productionEnabled: boolean; createdAt: string;
  ownerName: string | null; ownerEmail: string | null;
  users: number; orders: number; products: number;
};
async function platformFetch<T>(key: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/platform${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-platform-key": key.trim(), ...(init?.headers ?? {}) },
  });
  if (res.status === 401) throw new Error("Chave de plataforma inválida.");
  if (res.status === 503) throw new Error("Painel desabilitado no servidor (defina PLATFORM_ADMIN_KEY).");
  if (!res.ok) { const e = await res.json().catch(() => null); throw new Error(typeof e?.error === "string" ? e.error : `HTTP ${res.status}`); }
  return res.json();
}
export const platform = {
  tenants: (key: string) => platformFetch<PlatformTenant[]>(key, `/tenants`),
  createTenant: (key: string, input: { storeName: string; slug: string; ownerName: string; ownerEmail: string; password: string; status?: string }) =>
    platformFetch<{ id: string; slug: string; name: string; status: string }>(key, `/tenants`, { method: "POST", body: JSON.stringify(input) }),
  setStatus: (key: string, id: string, status: "active" | "suspended" | "trial") =>
    platformFetch<{ ok: boolean; status: string }>(key, `/tenants/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
};

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

export type ContactRow = {
  id: string; name: string | null; phoneMasked: string | null; emailMasked: string | null;
  igHandle: string | null; hasPhone: boolean; hasEmail: boolean;
  consentLGPD: boolean; optOuts: string[];
  cashbackBRL: number; ordersCount: number; totalSpentBRL: number;
  lastOrderAt: string | null; createdAt: string;
};
export type ContactStats = {
  total: number; consented: number; optedOutMarketing: number; withCashback: number;
  reachableWhatsapp: number; reachableEmail: number;
};

export type MarketingReport = {
  cashback: {
    accruedBRL: number; redeemedBRL: number; expiredBRL: number;
    activeBalanceBRL: number; expiring30BRL: number; redemptionRate: number;
    contactsWithBalance: number;
  };
  campaigns: { total: number; sent: number; recipients: number; sentWhatsapp: number; sentEmail: number; sentSms: number };
};

export type CampaignChannel = "whatsapp" | "email" | "sms";
export type Campaign = {
  id: string; title: string; message: string; subject: string | null;
  channels: CampaignChannel[]; onlyBuyers: boolean;
  status: "rascunho" | "enviada";
  recipients: number; sentWhatsapp: number; sentEmail: number; sentSms: number; skipped: number;
  sentAt: string | null; createdAt: string;
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
  // Catálogo unificado (banco): erp sincronizado + manuais. Propaga erro (a tela
  // mostra; 401 dispara logout global). Inclui Authorization + tenantSlug.
  listCatalogProducts: () => get<CatalogProduct[]>(`/catalog/products`),
  createProduct: (input: ProductInput) => post<CatalogProduct>(`/catalog/products`, input as any),
  updateProduct: (id: string, input: Partial<ProductInput>) => put<CatalogProduct>(`/catalog/products/${id}`, input as any),
  deleteProduct: (id: string) => del<{ ok: boolean }>(`/catalog/products/${id}`),
  syncCatalog: () => post<{ ok: boolean; upserted: number }>(`/catalog/sync`, {}),
  cacheStats: () => get<any>(`/admin/cache/stats`),
  getConfig: () => get<{ aiEnabled: boolean; monthlyAIBudgetBRL: number; autoApproveMaxBRL: number; retentionDays: number | null; orderRetentionDays: number | null; segment?: string; catalogVocab?: { styles?: string[]; occasions?: string[] } | null; productionEnabled?: boolean; storeZip?: string | null; cashback?: { enabled: boolean; pct: number; expiryDays: number; maxRedeemPct: number } }>(`/admin/config`),
  setCashbackConfig: (payload: { enabled?: boolean; pct?: number; expiryDays?: number; maxRedeemPct?: number }) =>
    post<{ ok: boolean }>(`/admin/cashback-config`, payload),
  setStoreZip: (storeZip: string | null) => post<{ ok: boolean; storeZip: string | null }>(`/admin/store-config`, { storeZip }),
  // Clientes / CRM (ADR-031)
  contacts: (params?: { q?: string; optedOut?: boolean; withCashback?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.optedOut) qs.set("optedOut", "true");
    if (params?.withCashback) qs.set("withCashback", "true");
    const s = qs.toString();
    return get<ContactRow[]>(`/contacts${s ? `?${s}` : ""}`);
  },
  contactStats: () => get<ContactStats>(`/contacts/stats`),
  createContact: (input: { name?: string; phone?: string; email?: string; igHandle?: string; consentLGPD?: boolean }) =>
    post<{ id: string; created: boolean }>(`/contacts`, input),
  setContactConsent: (id: string, input: { consentLGPD?: boolean; optOuts?: string[] }) =>
    patch<{ ok: boolean }>(`/contacts/${id}/consent`, input),
  // Promoções / broadcast (ADR-031)
  marketingReport: () => get<MarketingReport>(`/marketing/report`),
  campaigns: () => get<Campaign[]>(`/marketing/campaigns`),
  segmentPreview: (onlyBuyers: boolean) =>
    get<{ total: number; withPhone: number; withEmail: number }>(`/marketing/segment-preview?onlyBuyers=${onlyBuyers}`),
  createCampaign: (input: { title: string; message: string; subject?: string; channels: CampaignChannel[]; onlyBuyers?: boolean }) =>
    post<Campaign>(`/marketing/campaigns`, input),
  sendCampaign: (id: string) => post<Campaign>(`/marketing/campaigns/${id}/send`, {}),
  cashbackNudgePreview: (withinDays = 5) =>
    get<{ contacts: number; totalBRL: number; withinDays: number }>(`/marketing/cashback-nudge/preview?withinDays=${withinDays}`),
  sendCashbackNudge: (withinDays = 5) =>
    post<{ contacts: number; sentWhatsapp: number; sentEmail: number; sentSms: number; skipped: number }>(`/marketing/cashback-nudge`, { withinDays }),
  segmentPresets: () => get<SegmentPreset[]>(`/admin/segment-presets`),
  setSegment: (payload: { segment: string; styles?: string[]; occasions?: string[]; applyVoice?: boolean }) =>
    post<{ ok: boolean; segment: string; catalogVocab: { styles: string[]; occasions: string[] } | null; voiceApplied?: boolean }>(`/admin/segment-config`, payload),
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
  dispatchCourier: (orderId: string) =>
    post<{ ok: boolean; provider?: string; deliveryId?: string; status?: string; trackingUrl?: string | null; priceBRL?: number; modal?: string; error?: string }>(`/orders/${orderId}/dispatch-courier`, {}),
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
  mercExtractFile: (payload: { supplierName: string; researchId?: string; supplierId?: string; attachments: Array<{ fileName: string; mimeType: string; dataBase64: string }> }) =>
    post<{ ok: boolean; count?: number; reason?: string }>(`/mercadologica/quotes/extract-file`, payload),
  mercPendingQuotes: () => get<MercPendingQuote[]>(`/mercadologica/quotes/pending`),
  mercApproveQuote: (id: string) => post<{ ok: boolean }>(`/mercadologica/quotes/${id}/approve`, {}),
  mercRejectQuote: (id: string, reason?: string) => post<{ ok: boolean }>(`/mercadologica/quotes/${id}/reject`, { reason }),
  mercPanel: () => get<MercPanel>(`/mercadologica/panel`),

  // ── Mídia paga / Theo (ADR-028) ──
  adsStatus: () => get<IntegrationStatus>(`/ads/status`),
  adsAudiences: () => get<AdAudience[]>(`/ads/audiences`),
  adsCampaigns: () => get<AdCampaign[]>(`/ads/campaigns`),
  adsGenerateCreative: (payload: { objective: string; productOrOffer: string; audienceLabel?: string }) =>
    post<{ ok: boolean; creative?: { headline: string; primaryText: string; cta: string }; error?: string }>(`/ads/creative`, payload),
  adsCreateCampaign: (payload: { name: string; objective: string; dailyBudgetBRL: number; audience?: { label?: string; definition?: Record<string, unknown> }; creative?: { headline?: string; primaryText?: string; cta?: string } }) =>
    post<{ ok: boolean; id?: string; externalId?: string | null; status?: string }>(`/ads/campaigns`, payload),
  adsSetStatus: (id: string, status: "ativa" | "pausada") =>
    post<{ ok: boolean; status?: string }>(`/ads/campaigns/${id}/status`, { status }),
  adsRefreshInsights: (id: string) =>
    post<{ ok: boolean; metrics?: AdMetrics; reason?: string }>(`/ads/campaigns/${id}/insights`, {}),

  // ── Credenciais de integração por loja (gravadas pelo painel) ──
  integrationConfig: (provider: string) => get<IntegrationConfig>(`/integrations/${provider}/config`),
  saveIntegrationConfig: (provider: string, values: Record<string, string>) =>
    post<IntegrationConfig>(`/integrations/${provider}/config`, { values }),

  // ── Fabricação / ficha técnica (ADR-030) ──
  listMaterials: (category?: string) =>
    get<RawMaterial[]>(`/manufacturing/materials${category ? `?category=${category}` : ""}`),
  materialsReorder: () => get<InsumoReorder[]>(`/manufacturing/materials/reorder`),
  createMaterial: (payload: RawMaterialInput) => post<RawMaterial>(`/manufacturing/materials`, payload as any),
  updateMaterial: (id: string, payload: Partial<RawMaterialInput>) => put<RawMaterial>(`/manufacturing/materials/${id}`, payload as any),
  deleteMaterial: (id: string) => del<{ ok: boolean }>(`/manufacturing/materials/${id}`),
  listBoms: () => get<Bom[]>(`/manufacturing/boms`),
  createBom: (payload: BomInput) => post<Bom>(`/manufacturing/boms`, payload as any),
  updateBom: (id: string, payload: BomInput) => put<Bom>(`/manufacturing/boms/${id}`, payload as any),
  deleteBom: (id: string) => del<{ ok: boolean }>(`/manufacturing/boms/${id}`),
  // Produção (Fase 2)
  listBatches: () => get<ProductionBatch[]>(`/manufacturing/production`),
  productionAgenda: () => get<AgendaItem[]>(`/manufacturing/production/agenda`),
  manufacturingReport: () => get<ManufacturingReport>(`/manufacturing/report`),
  produceOrderItem: (orderId: string, variantSku: string) =>
    post<{ ok: boolean; batchId?: string; totalCost?: number; hasShortfall?: boolean; error?: string }>(`/manufacturing/production/produce-order`, { orderId, variantSku }),
  previewProduction: (bomId: string, quantity: number) =>
    post<ProductionPlan>(`/manufacturing/production/preview`, { bomId, quantity }),
  createBatch: (payload: { bomId: string; quantity: number; addToStock?: boolean; note?: string | null }) =>
    post<{ ok: boolean; batchId: string; addedToStock: boolean; unitCost: number; totalCost: number; hasShortfall: boolean }>(`/manufacturing/production`, payload as any),
  // Entrega própria (Fase 3)
  getDeliveryTariff: () => get<DeliveryTariff>(`/manufacturing/delivery/tariff`),
  saveDeliveryTariff: (payload: { motoVolumeLimit: number; bands: DeliveryBand[] }) =>
    post<{ ok: boolean; motoVolumeLimit: number; bands: DeliveryBand[] }>(`/manufacturing/delivery/tariff`, payload as any),
  quoteDelivery: (distanceKm: number, volume: number) =>
    post<DeliveryQuote>(`/manufacturing/delivery/quote`, { distanceKm, volume }),
  courierQuote: (payload: { fromCep: string; toCep: string; modal?: "moto" | "carro"; itemsValueBRL?: number }) =>
    post<CourierQuoteResult>(`/manufacturing/delivery/courier-quote`, payload as any),
};

export type CourierQuoteResult =
  | { ok: true; provider: string; mock: boolean; modal: "moto" | "carro"; priceBRL: number; etaMinutes?: number; distanceKm?: number; pickup: { lat: number; lng: number }; dropoff: { lat: number; lng: number } }
  | { ok: false; reason: string };

export type DeliveryBand = { modal: "moto" | "carro"; maxKm: number; priceBRL: number };
export type DeliveryTariff = { motoVolumeLimit: number; bands: DeliveryBand[]; configured: boolean };
export type DeliveryQuote = {
  modal: "moto" | "carro"; priceBRL: number; distanceKm: number; volume: number;
  maxKm: number | null; outOfRange: boolean; noTariff: boolean;
};

export type ConsumptionLine = {
  materialId: string; name: string; baseUnit: string;
  needed: number; available: number; shortfall: number; costPerBaseUnit: number;
};
export type ProductionPlan = {
  bomId: string; bomName: string; quantity: number;
  lines: ConsumptionLine[]; unitCost: number; totalCost: number;
  productId: string | null; variantSku: string | null;
  canAddToStock: boolean; suggestedToStock: boolean; hasShortfall: boolean;
};
export type ProductionBatch = {
  id: string; bomName: string; productId: string | null; variantSku: string | null;
  quantity: number; addedToStock: boolean; unitCost: number; totalCost: number;
  consumed: Array<{ name: string; baseUnit: string; quantity: number }>;
  note: string | null; createdAt: string;
};
export type AgendaItem = {
  orderId: string; contactName: string; productName: string; variantSku: string;
  quantity: number; orderDate: string; leadTimeDays: number | null; dueDate: string;
  dateSource: "desejada" | "estimada"; status: string;
};
export type ManufacturingReport = {
  margins: Array<{ productName: string; priceBRL: number; unitCost: number; marginBRL: number; marginPct: number }>;
  production: { batches: number; units: number; totalCostBRL: number; byProduct: Array<{ name: string; units: number; costBRL: number }> };
  insumoConsumption: Array<{ name: string; baseUnit: string; quantity: number; costBRL: number }>;
};

export type RawMaterial = {
  id: string; name: string; category: string; baseUnit: string; sku: string | null;
  costPerBaseUnit: number; purchaseUnit: string | null; purchaseQtyInBase: number | null;
  stockQty: number; minStockQty: number | null; lowStock: boolean; supplierId: string | null; active: boolean;
};
export type RawMaterialInput = {
  name: string; category?: string; baseUnit?: string; sku?: string | null;
  costPerBaseUnit?: number; purchaseUnit?: string | null; purchaseQtyInBase?: number | null;
  stockQty?: number; minStockQty?: number | null; supplierId?: string | null;
};
export type InsumoReorder = {
  id: string; name: string; category: string; baseUnit: string;
  stockQty: number; minStockQty: number; suggestedQty: number;
  purchaseUnit: string | null; purchaseUnits: number | null; supplierId: string | null;
};
export type BomLine = {
  materialId: string; materialName: string; baseUnit: string; category: string;
  costPerBaseUnit: number; quantity: number; lineCost: number; note: string | null;
};
export type Bom = {
  id: string; name: string; productId: string | null; variantSku: string | null;
  yieldQty: number; yieldUnit: string | null; lossPct: number; notes: string | null;
  items: BomLine[]; totalCost: number; unitCost: number;
};
export type BomInput = {
  name: string; productId?: string | null; variantSku?: string | null;
  yieldQty?: number; yieldUnit?: string | null; lossPct?: number; notes?: string | null;
  items: Array<{ materialId: string; quantity: number; note?: string | null }>;
};

export type IntegrationConfigField = {
  key: string; label: string; secret: boolean; required: boolean;
  source: "db" | "env" | "none"; set: boolean; preview: string;
};
export type IntegrationConfig = { provider: string; fields: IntegrationConfigField[]; appConfigured: boolean };

export type ProductVariant = { sku: string; color?: string; size?: string; stock: number };
export type CatalogProduct = {
  id: string;
  externalId: string;
  source: "erp" | "manual";
  name: string;
  description?: string | null;
  priceBRL: number;
  costBRL?: number | null;
  variants: ProductVariant[];
  measurements?: Record<string, { bust?: number; waist?: number; hips?: number; length?: number }> | null;
  styles?: string[];
  occasions?: string[];
  active?: boolean;
};
export type ProductInput = {
  name: string;
  description?: string;
  priceBRL: number;
  costBRL?: number | null;
  variants: ProductVariant[];
  measurements?: Record<string, { bust?: number; waist?: number; hips?: number; length?: number }> | null;
};

export type AdAudience = { key: string; label: string; size: number; definition: Record<string, unknown> };
export type AdMetrics = { impressions: number; clicks: number; spendBRL: number; conversions: number; ctr: number; roas: number; updatedAt?: string };
export type AdCampaign = {
  id: string; name: string; objective: string; status: string; dailyBudgetBRL: number;
  audience: { label?: string } | null;
  creative: { headline?: string; primaryText?: string; cta?: string } | null;
  metrics: AdMetrics | null; externalId: string | null; createdAt: string;
};

/** Abre um anexo de proposta (com token de auth) numa nova aba. */
export async function openMercAttachment(id: string) {
  const res = await fetch(`/api/mercadologica/attachments/${id}?tenantSlug=${tenantSlug()}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`anexo → ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

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

export type SegmentPreset = {
  id: string; label: string; paletteKey: string;
  styles: string[]; occasions: string[]; aiVoice: string;
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
