import { getPrisma, withTenant, encryptPII, decryptPII } from "@hubadvisor/db";
import {
  exchangeTrayCode, refreshTrayToken, type TrayTokens,
  exchangeMpCode, refreshMpToken, buildMpAuthorizeUrl,
  exchangeMeCode, refreshMeToken, buildMeAuthorizeUrl,
  exchangeBlingCode, refreshBlingToken, buildBlingAuthorizeUrl, type BlingTokens,
} from "@hubadvisor/connectors";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

async function upsertIntegration(tenantId: string, provider: string, data: Record<string, unknown>) {
  await withTenant(tenantId, async (tx) => {
    await tx.integration.upsert({
      where: { tenantId_provider: { tenantId, provider } },
      create: { tenantId, provider, ...data },
      update: data,
    });
    await tx.domainEvent.create({
      data: {
        tenantId, type: "integration.connected", aggregateType: "integration",
        aggregateId: provider, payload: { provider } as any, actor: "operator",
      },
    });
  });
}

async function getIntegration(tenantId: string, provider: string) {
  return getPrisma().integration.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
  });
}

function safeStatus(row: Awaited<ReturnType<typeof getIntegration>>) {
  if (!row) return "disconnected";
  return row.status;
}

// ──────────────────────────────────────────────────────────────────────────────
// Credenciais de app POR LOJA (cifradas em Integration.appConfig).
// Resolução: valor do banco tem prioridade; cai para a env var como fallback.
// ──────────────────────────────────────────────────────────────────────────────

export type CredField = { key: string; label: string; secret: boolean; env?: string; required?: boolean; placeholder?: string };

export const PROVIDER_FIELDS: Record<string, CredField[]> = {
  tray: [
    { key: "consumerKey", label: "Consumer Key", secret: true, env: "TRAY_CONSUMER_KEY", required: true },
    { key: "consumerSecret", label: "Consumer Secret", secret: true, env: "TRAY_CONSUMER_SECRET", required: true },
  ],
  bling: [
    { key: "clientId", label: "Client ID", secret: false, env: "BLING_CLIENT_ID", required: true },
    { key: "clientSecret", label: "Client Secret", secret: true, env: "BLING_CLIENT_SECRET", required: true },
  ],
  omie: [
    { key: "appKey", label: "App Key", secret: true, env: "OMIE_APP_KEY", required: true },
    { key: "appSecret", label: "App Secret", secret: true, env: "OMIE_APP_SECRET", required: true },
  ],
  vhsys: [
    { key: "accessToken", label: "Access Token", secret: true, env: "VHSYS_ACCESS_TOKEN", required: true },
    { key: "secretToken", label: "Secret Access Token", secret: true, env: "VHSYS_SECRET_TOKEN", required: true },
  ],
  mercadopago: [
    { key: "appId", label: "App ID", secret: false, env: "MERCADOPAGO_APP_ID", required: true },
    { key: "appSecret", label: "App Secret", secret: true, env: "MERCADOPAGO_APP_SECRET", required: true },
    { key: "accessToken", label: "Access Token (opcional — conexão direta, dispensa OAuth)", secret: true, env: "MERCADOPAGO_ACCESS_TOKEN" },
  ],
  "melhor-envio": [
    { key: "clientId", label: "Client ID", secret: false, env: "MELHORENVIO_CLIENT_ID", required: true },
    { key: "clientSecret", label: "Client Secret", secret: true, env: "MELHORENVIO_CLIENT_SECRET", required: true },
    { key: "accessToken", label: "Access Token (opcional)", secret: true, env: "MELHORENVIO_ACCESS_TOKEN" },
  ],
  whatsapp: [
    { key: "phoneNumberId", label: "Phone Number ID", secret: false, env: "WHATSAPP_PHONE_NUMBER_ID", required: true },
    { key: "accessToken", label: "Access Token", secret: true, env: "WHATSAPP_ACCESS_TOKEN", required: true },
    { key: "verifyToken", label: "Webhook Verify Token", secret: true, env: "META_WEBHOOK_VERIFY_TOKEN" },
  ],
  instagram: [
    { key: "accessToken", label: "Access Token", secret: true, env: "INSTAGRAM_ACCESS_TOKEN", required: true },
  ],
  cplug: [
    { key: "apiUrl", label: "API URL", secret: false, env: "CPLUG_API_URL", required: true },
    { key: "clientId", label: "Client ID", secret: false, env: "CPLUG_CLIENT_ID", required: true },
    { key: "clientSecret", label: "Client Secret", secret: true, env: "CPLUG_CLIENT_SECRET", required: true },
    { key: "storeUser", label: "Usuário da loja", secret: false, env: "CPLUG_STORE_USER", required: true },
    { key: "storePassword", label: "Senha da loja", secret: true, env: "CPLUG_STORE_PASSWORD", required: true },
  ],
  anthropic: [
    { key: "apiKey", label: "API Key", secret: true, env: "ANTHROPIC_API_KEY", required: true },
  ],
  lalamove: [
    { key: "apiKey", label: "API Key", secret: true, env: "LALAMOVE_API_KEY", required: true },
    { key: "apiSecret", label: "API Secret", secret: true, env: "LALAMOVE_API_SECRET", required: true },
    { key: "market", label: "Market (ex.: BR)", secret: false, env: "LALAMOVE_MARKET" },
  ],
  opendelivery: [
    { key: "clientId", label: "Client ID", secret: false, env: "OPENDELIVERY_CLIENT_ID", required: true },
    { key: "clientSecret", label: "Client Secret", secret: true, env: "OPENDELIVERY_CLIENT_SECRET", required: true },
    { key: "baseUrl", label: "Base URL (do operador logístico)", secret: false, env: "OPENDELIVERY_BASE_URL", required: true },
  ],
  zenvia: [
    { key: "token", label: "API Token", secret: true, env: "ZENVIA_TOKEN", required: true },
    { key: "from", label: "Remetente (sender)", secret: false, env: "ZENVIA_FROM", required: true },
  ],
};

function readDbConfig(row: Awaited<ReturnType<typeof getIntegration>>): Record<string, string> {
  const raw = decryptPII(row?.appConfig ?? null);
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, string>; } catch { return {}; }
}

/** Config mesclada (banco → env) de um provider, já decifrada. */
export async function getProviderConfig(tenantId: string, provider: string): Promise<Record<string, string>> {
  const fields = PROVIDER_FIELDS[provider];
  if (!fields) return {};
  const db = readDbConfig(await getIntegration(tenantId, provider));
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = db[f.key] ?? (f.env ? process.env[f.env] : undefined);
    if (v) out[f.key] = v;
  }
  return out;
}

/** True se todos os campos `required` do provider estão presentes (banco ou env). */
export async function isAppConfigured(tenantId: string, provider: string): Promise<boolean> {
  const fields = PROVIDER_FIELDS[provider];
  if (!fields) return false;
  const cfg = await getProviderConfig(tenantId, provider);
  return fields.filter((f) => f.required).every((f) => !!cfg[f.key]);
}

/** Grava credenciais (merge). Valor vazio/null remove a chave (volta ao fallback de env). */
export async function saveProviderConfig(tenantId: string, provider: string, values: Record<string, string | null | undefined>) {
  const fields = PROVIDER_FIELDS[provider];
  if (!fields) throw new Error(`provider desconhecido: ${provider}`);
  const allowed = new Set(fields.map((f) => f.key));
  const row = await getIntegration(tenantId, provider);
  const current = readDbConfig(row);
  for (const [k, v] of Object.entries(values)) {
    if (!allowed.has(k)) continue;
    const trimmed = typeof v === "string" ? v.trim() : v;
    if (trimmed === "" || trimmed == null) delete current[k];
    else current[k] = trimmed;
  }
  const enc = Object.keys(current).length ? encryptPII(JSON.stringify(current)) : null;
  await withTenant(tenantId, async (tx) => {
    await tx.integration.upsert({
      where: { tenantId_provider: { tenantId, provider } },
      create: { tenantId, provider, status: "disconnected", appConfig: enc },
      update: { appConfig: enc },
    });
  });
  return { ok: true as const };
}

/** Visão segura p/ o painel: quais campos estão setados, valor mascarado e origem. */
export async function getMaskedConfig(tenantId: string, provider: string) {
  const fields = PROVIDER_FIELDS[provider];
  if (!fields) throw new Error(`provider desconhecido: ${provider}`);
  const db = readDbConfig(await getIntegration(tenantId, provider));
  return {
    provider,
    fields: fields.map((f) => {
      const inDb = !!db[f.key];
      const envVal = f.env ? process.env[f.env] : undefined;
      const source = inDb ? "db" : envVal ? "env" : "none";
      const value = inDb ? db[f.key]! : envVal ?? "";
      const preview = !value ? "" : f.secret ? `••••${value.slice(-4)}` : value;
      return { key: f.key, label: f.label, secret: f.secret, required: !!f.required, source, set: source !== "none", preview };
    }),
    appConfigured: await isAppConfigured(tenantId, provider),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// TRAY
// ──────────────────────────────────────────────────────────────────────────────

async function trayAppCreds(tenantId: string) {
  const cfg = await getProviderConfig(tenantId, "tray");
  return {
    consumerKey: cfg.consumerKey ?? "",
    consumerSecret: cfg.consumerSecret ?? "",
  };
}

export type TrayStatus = {
  provider: "tray"; connected: boolean; status: string;
  storeId: string | null; apiAddress: string | null;
  connectedAt: string | null; accessExpiresAt: string | null; refreshExpiresAt: string | null;
  appConfigured: boolean; lastError: string | null;
};

async function persistTrayTokens(tenantId: string, tokens: TrayTokens) {
  await upsertIntegration(tenantId, "tray", {
    status: "connected",
    apiAddress: tokens.apiAddress ?? null,
    storeId: tokens.storeId ?? null,
    accessToken: encryptPII(tokens.accessToken),
    refreshToken: encryptPII(tokens.refreshToken),
    accessExpiresAt: tokens.accessExpiresAt ?? null,
    refreshExpiresAt: tokens.refreshExpiresAt ?? null,
    lastError: null,
    connectedAt: new Date(),
  });
}

/** Normaliza um endereço (web_api) para comparação tolerante. */
function normAddr(a: string | null | undefined): string {
  return (a ?? "").trim().toLowerCase().replace(/\/+$/, "");
}

/** Persiste o web_api informado pela loja ao INICIAR a autorização Tray, para
 *  que o callback (que não carrega o slug) consiga resolver o tenant. */
export async function saveTrayApiAddress(tenantId: string, apiAddress: string) {
  await withTenant(tenantId, async (tx) => {
    await tx.integration.upsert({
      where: { tenantId_provider: { tenantId, provider: "tray" } },
      create: { tenantId, provider: "tray", apiAddress, status: "disconnected" },
      update: { apiAddress },
    });
  });
}

/** Resolve o tenant de um callback Tray pelo api_address devolvido (sem `state`).
 *  Casa pelo web_api salvo no authorize; se não achar e só houver uma integração
 *  Tray, usa essa (loja única). */
export async function resolveTrayTenantId(apiAddress: string): Promise<string | null> {
  const rows = await getPrisma().integration.findMany({ where: { provider: "tray" } });
  const target = normAddr(apiAddress);
  const targetHost = (() => { try { return new URL(apiAddress).host.replace(/^www\./, ""); } catch { return ""; } })();
  const match = rows.find((r) => normAddr(r.apiAddress) === target)
    ?? rows.find((r) => { try { return new URL(r.apiAddress ?? "").host.replace(/^www\./, "") === targetHost; } catch { return false; } });
  if (match) return match.tenantId;
  return rows.length === 1 ? rows[0]!.tenantId : null;
}

export async function connectTrayFromCallback(tenantId: string, code: string, apiAddress: string) {
  const { consumerKey, consumerSecret } = await trayAppCreds(tenantId);
  if (!consumerKey || !consumerSecret) throw new Error("Credenciais Tray (Consumer Key/Secret) não configuradas");
  const tokens = await exchangeTrayCode({ apiAddress, consumerKey, consumerSecret, code });
  await persistTrayTokens(tenantId, tokens);
  return { ok: true as const, storeId: tokens.storeId ?? null };
}

export async function refreshTray(tenantId: string) {
  const row = await getIntegration(tenantId, "tray");
  const refreshToken = decryptPII(row?.refreshToken);
  if (!row?.apiAddress || !refreshToken) throw new Error("Tray não conectado");
  try {
    const tokens = await refreshTrayToken({ apiAddress: row.apiAddress, refreshToken });
    await persistTrayTokens(tenantId, tokens);
    return { ok: true as const };
  } catch (e: any) {
    await withTenant(tenantId, async (tx) => {
      await tx.integration.update({
        where: { tenantId_provider: { tenantId, provider: "tray" } },
        data: { status: "error", lastError: String(e?.message ?? e) },
      });
    });
    throw e;
  }
}

export async function disconnectTray(tenantId: string) {
  await withTenant(tenantId, async (tx) => {
    await tx.integration.updateMany({
      where: { tenantId, provider: "tray" },
      data: { status: "disconnected", accessToken: null, refreshToken: null, connectedAt: null, lastError: null },
    });
  });
  return { ok: true as const };
}

export async function getTrayStatus(tenantId: string): Promise<TrayStatus> {
  const row = await getIntegration(tenantId, "tray");
  const connected = !!row && row.status === "connected" && !!row.accessToken;
  return {
    provider: "tray", connected, status: row?.status ?? "disconnected",
    storeId: row?.storeId ?? null, apiAddress: row?.apiAddress ?? null,
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    accessExpiresAt: row?.accessExpiresAt?.toISOString() ?? null,
    refreshExpiresAt: row?.refreshExpiresAt?.toISOString() ?? null,
    appConfigured: await isAppConfigured(tenantId, "tray"),
    lastError: row?.lastError ?? null,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// MERCADO PAGO
// ──────────────────────────────────────────────────────────────────────────────

export type MpStatus = {
  provider: "mercadopago"; connected: boolean; status: string;
  userId: string | null; connectedAt: string | null;
  appConfigured: boolean; envToken: boolean; lastError: string | null;
};

export async function buildMpUrl(tenantId: string, redirectUri: string, state: string) {
  const cfg = await getProviderConfig(tenantId, "mercadopago");
  return buildMpAuthorizeUrl(redirectUri, state, cfg.appId);
}

export async function connectMpFromCallback(tenantId: string, code: string, redirectUri: string) {
  const cfg = await getProviderConfig(tenantId, "mercadopago");
  const tokens = await exchangeMpCode({ code, redirectUri, creds: { appId: cfg.appId, appSecret: cfg.appSecret } });
  await upsertIntegration(tenantId, "mercadopago", {
    status: "connected",
    storeId: tokens.userId,
    accessToken: encryptPII(tokens.accessToken),
    refreshToken: encryptPII(tokens.refreshToken),
    accessExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
    lastError: null,
    connectedAt: new Date(),
  });
  return { ok: true as const, userId: tokens.userId };
}

export async function refreshMp(tenantId: string) {
  const row = await getIntegration(tenantId, "mercadopago");
  const refreshToken = decryptPII(row?.refreshToken);
  if (!refreshToken) throw new Error("Mercado Pago não conectado");
  try {
    const cfg = await getProviderConfig(tenantId, "mercadopago");
    const tokens = await refreshMpToken(refreshToken, { appId: cfg.appId, appSecret: cfg.appSecret });
    await withTenant(tenantId, async (tx) => {
      await tx.integration.update({
        where: { tenantId_provider: { tenantId, provider: "mercadopago" } },
        data: {
          status: "connected",
          accessToken: encryptPII(tokens.accessToken),
          refreshToken: encryptPII(tokens.refreshToken),
          accessExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
          lastError: null,
        },
      });
    });
    return { ok: true as const };
  } catch (e: any) {
    await withTenant(tenantId, async (tx) => {
      await tx.integration.update({
        where: { tenantId_provider: { tenantId, provider: "mercadopago" } },
        data: { status: "error", lastError: String(e?.message ?? e) },
      });
    });
    throw e;
  }
}

export async function disconnectMp(tenantId: string) {
  await withTenant(tenantId, async (tx) => {
    await tx.integration.updateMany({
      where: { tenantId, provider: "mercadopago" },
      data: { status: "disconnected", accessToken: null, refreshToken: null, connectedAt: null, lastError: null },
    });
  });
  return { ok: true as const };
}

export async function getMpStatus(tenantId: string): Promise<MpStatus> {
  const row = await getIntegration(tenantId, "mercadopago");
  const cfg = await getProviderConfig(tenantId, "mercadopago");
  const hasDirectToken = !!cfg.accessToken;
  const connected = (!!row && row.status === "connected" && !!row.accessToken) || hasDirectToken;
  return {
    provider: "mercadopago", connected,
    status: row?.status ?? (hasDirectToken ? "connected" : "disconnected"),
    userId: row?.storeId ?? null,
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    appConfigured: await isAppConfigured(tenantId, "mercadopago"),
    envToken: hasDirectToken,
    lastError: row?.lastError ?? null,
  };
}

/** Retorna o access_token decifrado do tenant (OAuth), ou o token direto (banco/env). */
export async function getMpAccessToken(tenantId: string): Promise<string | null> {
  const row = await getIntegration(tenantId, "mercadopago");
  if (row?.status === "connected" && row.accessToken) return decryptPII(row.accessToken);
  const cfg = await getProviderConfig(tenantId, "mercadopago");
  return cfg.accessToken ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// MELHOR ENVIO
// ──────────────────────────────────────────────────────────────────────────────

export type MeStatus = {
  provider: "melhor-envio"; connected: boolean; status: string;
  connectedAt: string | null; appConfigured: boolean; envToken: boolean; lastError: string | null;
};

export async function buildMeUrl(tenantId: string, redirectUri: string, state: string) {
  const cfg = await getProviderConfig(tenantId, "melhor-envio");
  return buildMeAuthorizeUrl(redirectUri, state, cfg.clientId);
}

export async function connectMeFromCallback(tenantId: string, code: string, redirectUri: string) {
  const cfg = await getProviderConfig(tenantId, "melhor-envio");
  const tokens = await exchangeMeCode({ code, redirectUri, creds: { clientId: cfg.clientId, clientSecret: cfg.clientSecret } });
  await upsertIntegration(tenantId, "melhor-envio", {
    status: "connected",
    accessToken: encryptPII(tokens.accessToken),
    refreshToken: encryptPII(tokens.refreshToken),
    accessExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
    lastError: null,
    connectedAt: new Date(),
  });
  return { ok: true as const };
}

export async function refreshMe(tenantId: string) {
  const row = await getIntegration(tenantId, "melhor-envio");
  const refreshToken = decryptPII(row?.refreshToken);
  if (!refreshToken) throw new Error("Melhor Envio não conectado");
  try {
    const cfg = await getProviderConfig(tenantId, "melhor-envio");
    const tokens = await refreshMeToken(refreshToken, { clientId: cfg.clientId, clientSecret: cfg.clientSecret });
    await withTenant(tenantId, async (tx) => {
      await tx.integration.update({
        where: { tenantId_provider: { tenantId, provider: "melhor-envio" } },
        data: {
          status: "connected",
          accessToken: encryptPII(tokens.accessToken),
          refreshToken: encryptPII(tokens.refreshToken),
          accessExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
          lastError: null,
        },
      });
    });
    return { ok: true as const };
  } catch (e: any) {
    await withTenant(tenantId, async (tx) => {
      await tx.integration.update({
        where: { tenantId_provider: { tenantId, provider: "melhor-envio" } },
        data: { status: "error", lastError: String(e?.message ?? e) },
      });
    });
    throw e;
  }
}

export async function disconnectMe(tenantId: string) {
  await withTenant(tenantId, async (tx) => {
    await tx.integration.updateMany({
      where: { tenantId, provider: "melhor-envio" },
      data: { status: "disconnected", accessToken: null, refreshToken: null, connectedAt: null, lastError: null },
    });
  });
  return { ok: true as const };
}

export async function getMeStatus(tenantId: string): Promise<MeStatus> {
  const row = await getIntegration(tenantId, "melhor-envio");
  const cfg = await getProviderConfig(tenantId, "melhor-envio");
  const hasDirectToken = !!cfg.accessToken;
  const connected = (!!row && row.status === "connected" && !!row.accessToken) || hasDirectToken;
  return {
    provider: "melhor-envio", connected,
    status: row?.status ?? (hasDirectToken ? "connected" : "disconnected"),
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    appConfigured: await isAppConfigured(tenantId, "melhor-envio"),
    envToken: hasDirectToken,
    lastError: row?.lastError ?? null,
  };
}

export async function getMeAccessToken(tenantId: string): Promise<string | null> {
  const row = await getIntegration(tenantId, "melhor-envio");
  if (row?.status === "connected" && row.accessToken) return decryptPII(row.accessToken);
  const cfg = await getProviderConfig(tenantId, "melhor-envio");
  return cfg.accessToken ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// BLING (ERP — OAuth2 Authorization Code, ADR-004)
// ──────────────────────────────────────────────────────────────────────────────

export type BlingStatus = {
  provider: "bling"; connected: boolean; status: string;
  connectedAt: string | null; accessExpiresAt: string | null;
  appConfigured: boolean; lastError: string | null;
};

async function blingAppCreds(tenantId: string) {
  const cfg = await getProviderConfig(tenantId, "bling");
  return { clientId: cfg.clientId ?? "", clientSecret: cfg.clientSecret ?? "" };
}

async function persistBlingTokens(tenantId: string, tokens: BlingTokens) {
  await upsertIntegration(tenantId, "bling", {
    status: "connected",
    accessToken: encryptPII(tokens.accessToken),
    refreshToken: encryptPII(tokens.refreshToken),
    accessExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
    lastError: null,
    connectedAt: new Date(),
  });
}

export async function buildBlingUrl(tenantId: string, redirectUri: string, state: string) {
  const { clientId } = await blingAppCreds(tenantId);
  return buildBlingAuthorizeUrl({ clientId, state, redirectUri });
}

export async function connectBlingFromCallback(tenantId: string, code: string, redirectUri: string) {
  const creds = await blingAppCreds(tenantId);
  if (!creds.clientId || !creds.clientSecret) throw new Error("Credenciais Bling (Client ID/Secret) não configuradas");
  const tokens = await exchangeBlingCode({ code, creds, redirectUri });
  await persistBlingTokens(tenantId, tokens);
  return { ok: true as const };
}

export async function refreshBling(tenantId: string) {
  const row = await getIntegration(tenantId, "bling");
  const refreshToken = decryptPII(row?.refreshToken);
  if (!refreshToken) throw new Error("Bling não conectado");
  try {
    const creds = await blingAppCreds(tenantId);
    const tokens = await refreshBlingToken(refreshToken, creds);
    await persistBlingTokens(tenantId, tokens);
    return { ok: true as const };
  } catch (e: any) {
    await withTenant(tenantId, async (tx) => {
      await tx.integration.update({
        where: { tenantId_provider: { tenantId, provider: "bling" } },
        data: { status: "error", lastError: String(e?.message ?? e) },
      });
    });
    throw e;
  }
}

export async function disconnectBling(tenantId: string) {
  await withTenant(tenantId, async (tx) => {
    await tx.integration.updateMany({
      where: { tenantId, provider: "bling" },
      data: { status: "disconnected", accessToken: null, refreshToken: null, connectedAt: null, lastError: null },
    });
  });
  return { ok: true as const };
}

export async function getBlingStatus(tenantId: string): Promise<BlingStatus> {
  const row = await getIntegration(tenantId, "bling");
  const connected = !!row && row.status === "connected" && !!row.accessToken;
  return {
    provider: "bling", connected, status: row?.status ?? "disconnected",
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    accessExpiresAt: row?.accessExpiresAt?.toISOString() ?? null,
    appConfigured: await isAppConfigured(tenantId, "bling"),
    lastError: row?.lastError ?? null,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// WHATSAPP / INSTAGRAM (env-var only — sem OAuth próprio)
// ──────────────────────────────────────────────────────────────────────────────

export async function getWhatsAppStatus(tenantId: string) {
  const cfg = await getProviderConfig(tenantId, "whatsapp");
  const configured = !!cfg.phoneNumberId && !!cfg.accessToken;
  return {
    provider: "whatsapp" as const,
    connected: configured,
    status: configured ? "connected" : "disconnected",
    phoneNumberId: cfg.phoneNumberId ?? null,
    verifyTokenSet: !!cfg.verifyToken,
    appConfigured: configured,
    note: configured
      ? "Credenciais configuradas. Webhook Meta deve apontar para /api/webhooks/meta"
      : "Informe Phone Number ID e Access Token do WhatsApp Cloud.",
  };
}

export async function getInstagramStatus(tenantId: string) {
  const cfg = await getProviderConfig(tenantId, "instagram");
  const configured = !!cfg.accessToken;
  return {
    provider: "instagram" as const,
    connected: configured,
    status: configured ? "connected" : "disconnected",
    appConfigured: configured,
    note: configured
      ? "Credenciais configuradas. Webhook Meta deve apontar para /api/webhooks/meta"
      : "Informe o Access Token do Instagram.",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// CPLUG (fiscal — env-var only)
// ──────────────────────────────────────────────────────────────────────────────

export async function getCplugStatus(tenantId: string) {
  const configured = await isAppConfigured(tenantId, "cplug");
  return {
    provider: "cplug" as const,
    connected: configured,
    status: configured ? "connected" : "disconnected",
    appConfigured: configured,
    note: configured
      ? "Credenciais CPlug configuradas. NFe habilitada."
      : "Informe API URL, Client ID/Secret e usuário/senha da loja CPlug.",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// ANTHROPIC
// ──────────────────────────────────────────────────────────────────────────────

export async function getAnthropicStatus(tenantId: string) {
  const configured = await isAppConfigured(tenantId, "anthropic");
  return {
    provider: "anthropic" as const,
    connected: configured,
    status: configured ? "connected" : "disconnected",
    appConfigured: configured,
    note: configured ? "API Key configurada. Maya/Bia/Lia operacionais." : "Informe a API Key da Anthropic.",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// COURIER / entrega on-demand (Lalamove, Open Delivery) — credencial por loja
// ──────────────────────────────────────────────────────────────────────────────

export async function getLalamoveStatus(tenantId: string) {
  const configured = await isAppConfigured(tenantId, "lalamove");
  return {
    provider: "lalamove" as const,
    connected: configured,
    status: configured ? "connected" : "disconnected",
    appConfigured: configured,
    note: configured ? "Lalamove configurada (entregador on-demand)." : "Informe API Key e Secret da Lalamove (capitais/grandes cidades).",
  };
}

export async function getOpenDeliveryStatus(tenantId: string) {
  const configured = await isAppConfigured(tenantId, "opendelivery");
  return {
    provider: "opendelivery" as const,
    connected: configured,
    status: configured ? "connected" : "disconnected",
    appConfigured: configured,
    note: configured ? "Open Delivery configurado (Pedidos10/ABRASEL — cobre interior)." : "Informe Client ID/Secret e Base URL do operador logístico (padrão Open Delivery).",
  };
}

// ── OMIE (ERP — JSON-RPC, app_key/secret no corpo; sem OAuth) ────────────────
export async function getOmieStatus(tenantId: string) {
  const configured = await isAppConfigured(tenantId, "omie");
  return {
    provider: "omie" as const,
    connected: configured,
    status: configured ? "connected" : "disconnected",
    appConfigured: configured,
    note: configured ? "Omie configurada (ERP). Requer ERP_PROVIDER=omie." : "Informe App Key e App Secret da Omie.",
  };
}

export async function getOmieCreds(tenantId: string): Promise<{ appKey: string; appSecret: string } | null> {
  const cfg = await getProviderConfig(tenantId, "omie");
  if (!cfg.appKey || !cfg.appSecret) return null;
  return { appKey: cfg.appKey, appSecret: cfg.appSecret };
}

// ── VHSYS (ERP — REST v2, par de chaves nos headers; sem OAuth) ──────────────
export async function getVhsysStatus(tenantId: string) {
  const configured = await isAppConfigured(tenantId, "vhsys");
  return {
    provider: "vhsys" as const,
    connected: configured,
    status: configured ? "connected" : "disconnected",
    appConfigured: configured,
    note: configured ? "VHSYS configurada (ERP). Requer ERP_PROVIDER=vhsys." : "Informe Access Token e Secret Access Token da VHSYS.",
  };
}

export async function getVhsysCreds(tenantId: string): Promise<{ accessToken: string; secretToken: string } | null> {
  const cfg = await getProviderConfig(tenantId, "vhsys");
  if (!cfg.accessToken || !cfg.secretToken) return null;
  return { accessToken: cfg.accessToken, secretToken: cfg.secretToken };
}

/** Credenciais de courier do tenant (banco→env), p/ buildCourierForTenant. */
export async function getLalamoveCreds(tenantId: string): Promise<{ apiKey: string; apiSecret: string; market?: string } | null> {
  const cfg = await getProviderConfig(tenantId, "lalamove");
  if (!cfg.apiKey || !cfg.apiSecret) return null;
  return { apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, market: cfg.market };
}

export async function getOpenDeliveryCreds(tenantId: string): Promise<{ clientId: string; clientSecret: string; baseUrl: string } | null> {
  const cfg = await getProviderConfig(tenantId, "opendelivery");
  if (!cfg.clientId || !cfg.clientSecret || !cfg.baseUrl) return null;
  return { clientId: cfg.clientId, clientSecret: cfg.clientSecret, baseUrl: cfg.baseUrl };
}

// ── SMS (Zenvia) — broadcast de promoções (ADR-031) ──────────────────────────
export async function getZenviaStatus(tenantId: string) {
  const configured = await isAppConfigured(tenantId, "zenvia");
  return {
    provider: "zenvia" as const,
    connected: configured,
    status: configured ? "connected" : "disconnected",
    appConfigured: configured,
    note: configured ? "SMS (Zenvia) configurado para promoções." : "Informe o API Token e o remetente da Zenvia para enviar SMS.",
  };
}

export async function getSmsCreds(tenantId: string): Promise<{ token: string; from: string } | null> {
  const cfg = await getProviderConfig(tenantId, "zenvia");
  if (!cfg.token || !cfg.from) return null;
  return { token: cfg.token, from: cfg.from };
}
