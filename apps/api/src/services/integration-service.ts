import { getPrisma, withTenant, encryptPII, decryptPII } from "@hubadvisor/db";
import {
  exchangeTrayCode, refreshTrayToken, type TrayTokens,
  exchangeMpCode, refreshMpToken, buildMpAuthorizeUrl,
  exchangeMeCode, refreshMeToken, buildMeAuthorizeUrl,
  whatsappConfigured, instagramConfigured,
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
// TRAY
// ──────────────────────────────────────────────────────────────────────────────

function trayAppCreds() {
  return {
    consumerKey: process.env.TRAY_CONSUMER_KEY ?? "",
    consumerSecret: process.env.TRAY_CONSUMER_SECRET ?? "",
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

export async function connectTrayFromCallback(tenantId: string, code: string, apiAddress: string) {
  const { consumerKey, consumerSecret } = trayAppCreds();
  if (!consumerKey || !consumerSecret) throw new Error("TRAY_CONSUMER_KEY/SECRET não configurados");
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
  const { consumerKey, consumerSecret } = trayAppCreds();
  const connected = !!row && row.status === "connected" && !!row.accessToken;
  return {
    provider: "tray", connected, status: row?.status ?? "disconnected",
    storeId: row?.storeId ?? null, apiAddress: row?.apiAddress ?? null,
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    accessExpiresAt: row?.accessExpiresAt?.toISOString() ?? null,
    refreshExpiresAt: row?.refreshExpiresAt?.toISOString() ?? null,
    appConfigured: !!consumerKey && !!consumerSecret,
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

export function mpAppConfigured() {
  return !!(process.env.MERCADOPAGO_APP_ID && process.env.MERCADOPAGO_APP_SECRET);
}

export function buildMpUrl(redirectUri: string, state: string) {
  return buildMpAuthorizeUrl(redirectUri, state);
}

export async function connectMpFromCallback(tenantId: string, code: string, redirectUri: string) {
  const tokens = await exchangeMpCode({ code, redirectUri });
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
    const tokens = await refreshMpToken(refreshToken);
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
  const connected = (!!row && row.status === "connected" && !!row.accessToken)
    || !!process.env.MERCADOPAGO_ACCESS_TOKEN;
  return {
    provider: "mercadopago", connected,
    status: row?.status ?? (process.env.MERCADOPAGO_ACCESS_TOKEN ? "connected" : "disconnected"),
    userId: row?.storeId ?? null,
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    appConfigured: mpAppConfigured(),
    envToken: !!process.env.MERCADOPAGO_ACCESS_TOKEN,
    lastError: row?.lastError ?? null,
  };
}

/** Retorna o access_token decifrado do tenant (ou o env var global). */
export async function getMpAccessToken(tenantId: string): Promise<string | null> {
  const row = await getIntegration(tenantId, "mercadopago");
  if (row?.status === "connected" && row.accessToken) return decryptPII(row.accessToken);
  return process.env.MERCADOPAGO_ACCESS_TOKEN ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// MELHOR ENVIO
// ──────────────────────────────────────────────────────────────────────────────

export type MeStatus = {
  provider: "melhor-envio"; connected: boolean; status: string;
  connectedAt: string | null; appConfigured: boolean; envToken: boolean; lastError: string | null;
};

export function meAppConfigured() {
  return !!(process.env.MELHORENVIO_CLIENT_ID && process.env.MELHORENVIO_CLIENT_SECRET);
}

export function buildMeUrl(redirectUri: string, state: string) {
  return buildMeAuthorizeUrl(redirectUri, state);
}

export async function connectMeFromCallback(tenantId: string, code: string, redirectUri: string) {
  const tokens = await exchangeMeCode({ code, redirectUri });
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
    const tokens = await refreshMeToken(refreshToken);
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
  const connected = (!!row && row.status === "connected" && !!row.accessToken)
    || !!process.env.MELHORENVIO_ACCESS_TOKEN;
  return {
    provider: "melhor-envio", connected,
    status: row?.status ?? (process.env.MELHORENVIO_ACCESS_TOKEN ? "connected" : "disconnected"),
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    appConfigured: meAppConfigured(),
    envToken: !!process.env.MELHORENVIO_ACCESS_TOKEN,
    lastError: row?.lastError ?? null,
  };
}

export async function getMeAccessToken(tenantId: string): Promise<string | null> {
  const row = await getIntegration(tenantId, "melhor-envio");
  if (row?.status === "connected" && row.accessToken) return decryptPII(row.accessToken);
  return process.env.MELHORENVIO_ACCESS_TOKEN ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// WHATSAPP / INSTAGRAM (env-var only — sem OAuth próprio)
// ──────────────────────────────────────────────────────────────────────────────

export function getWhatsAppStatus() {
  const configured = whatsappConfigured();
  return {
    provider: "whatsapp" as const,
    connected: configured,
    status: configured ? "connected" : "disconnected",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? null,
    verifyTokenSet: !!process.env.META_WEBHOOK_VERIFY_TOKEN,
    note: configured
      ? "Credenciais configuradas. Webhook Meta deve apontar para /api/webhooks/meta"
      : "Configure WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_ACCESS_TOKEN no servidor",
  };
}

export function getInstagramStatus() {
  const configured = instagramConfigured();
  return {
    provider: "instagram" as const,
    connected: configured,
    status: configured ? "connected" : "disconnected",
    note: configured
      ? "Credenciais configuradas. Webhook Meta deve apontar para /api/webhooks/meta"
      : "Configure INSTAGRAM_ACCESS_TOKEN no servidor",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// CPLUG (fiscal — env-var only)
// ──────────────────────────────────────────────────────────────────────────────

export function getCplugStatus() {
  const configured = !!(
    process.env.CPLUG_API_URL &&
    process.env.CPLUG_CLIENT_ID &&
    process.env.CPLUG_CLIENT_SECRET &&
    process.env.CPLUG_STORE_USER &&
    process.env.CPLUG_STORE_PASSWORD
  );
  return {
    provider: "cplug" as const,
    connected: configured,
    status: configured ? "connected" : "disconnected",
    note: configured
      ? "Credenciais CPlug configuradas. NFe habilitada."
      : "Configure CPLUG_API_URL, CPLUG_CLIENT_ID, CPLUG_CLIENT_SECRET, CPLUG_STORE_USER e CPLUG_STORE_PASSWORD",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// ANTHROPIC
// ──────────────────────────────────────────────────────────────────────────────

export function getAnthropicStatus() {
  const configured = !!process.env.ANTHROPIC_API_KEY;
  return {
    provider: "anthropic" as const,
    connected: configured,
    status: configured ? "connected" : "disconnected",
    note: configured ? "API Key configurada. Maya/Bia/Lia operacionais." : "Configure ANTHROPIC_API_KEY no servidor",
  };
}
