import { getPrisma, withTenant, encryptPII, decryptPII } from "@thepop/db";
import {
  exchangeTrayCode,
  refreshTrayToken,
  type TrayTokens,
} from "@thepop/connectors";

// Onboarding/credenciais de integração externa (ADR-004). Hoje: Tray.
// Tokens cifrados at-rest (mesmo cofre de PII, enc:v1:). A API só expõe um
// STATUS redatado — nunca o token cru.

const PROVIDER = "tray";

function trayAppCreds() {
  return {
    consumerKey: process.env.TRAY_CONSUMER_KEY ?? "",
    consumerSecret: process.env.TRAY_CONSUMER_SECRET ?? "",
  };
}

/** Status seguro pra UI — sem tokens. */
export type TrayStatus = {
  provider: "tray";
  connected: boolean;
  status: string;
  storeId: string | null;
  apiAddress: string | null;
  connectedAt: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  /** true se faltam TRAY_CONSUMER_KEY/SECRET (não dá pra trocar code). */
  appConfigured: boolean;
  lastError: string | null;
};

async function persistTokens(tenantId: string, tokens: TrayTokens) {
  const prisma = getPrisma();
  const data = {
    status: "connected",
    apiAddress: tokens.apiAddress ?? null,
    storeId: tokens.storeId ?? null,
    accessToken: encryptPII(tokens.accessToken),
    refreshToken: encryptPII(tokens.refreshToken),
    accessExpiresAt: tokens.accessExpiresAt ?? null,
    refreshExpiresAt: tokens.refreshExpiresAt ?? null,
    lastError: null,
    connectedAt: new Date(),
  };
  await withTenant(tenantId, async (tx) => {
    await tx.integration.upsert({
      where: { tenantId_provider: { tenantId, provider: PROVIDER } },
      create: { tenantId, provider: PROVIDER, ...data },
      update: data,
    });
    await tx.domainEvent.create({
      data: {
        tenantId, type: "integration.connected", aggregateType: "integration",
        aggregateId: PROVIDER, payload: { provider: PROVIDER, storeId: tokens.storeId } as any, actor: "operator",
      },
    });
  });
}

/** Passo 2 do OAuth: troca o `code` do callback por tokens e persiste. */
export async function connectTrayFromCallback(tenantId: string, code: string, apiAddress: string) {
  const { consumerKey, consumerSecret } = trayAppCreds();
  if (!consumerKey || !consumerSecret) {
    throw new Error("TRAY_CONSUMER_KEY/SECRET não configurados — não dá pra trocar o code");
  }
  const tokens = await exchangeTrayCode({ apiAddress, consumerKey, consumerSecret, code });
  await persistTokens(tenantId, tokens);
  return { ok: true as const, storeId: tokens.storeId ?? null };
}

/** Renova o access_token (passo 3). Marca status=error se falhar. */
export async function refreshTray(tenantId: string) {
  const prisma = getPrisma();
  const row = await prisma.integration.findUnique({
    where: { tenantId_provider: { tenantId, provider: PROVIDER } },
  });
  const refreshToken = decryptPII(row?.refreshToken);
  if (!row?.apiAddress || !refreshToken) throw new Error("Tray não conectado");
  try {
    const tokens = await refreshTrayToken({ apiAddress: row.apiAddress, refreshToken });
    await persistTokens(tenantId, tokens);
    return { ok: true as const };
  } catch (e: any) {
    await withTenant(tenantId, async (tx) => {
      await tx.integration.update({
        where: { tenantId_provider: { tenantId, provider: PROVIDER } },
        data: { status: "error", lastError: String(e?.message ?? e) },
      });
    });
    throw e;
  }
}

/** Desconecta — apaga os tokens. */
export async function disconnectTray(tenantId: string) {
  await withTenant(tenantId, async (tx) => {
    await tx.integration.updateMany({
      where: { tenantId, provider: PROVIDER },
      data: { status: "disconnected", accessToken: null, refreshToken: null, connectedAt: null, lastError: null },
    });
    await tx.domainEvent.create({
      data: {
        tenantId, type: "integration.disconnected", aggregateType: "integration",
        aggregateId: PROVIDER, payload: { provider: PROVIDER } as any, actor: "operator",
      },
    });
  });
  return { ok: true as const };
}

export async function getTrayStatus(tenantId: string): Promise<TrayStatus> {
  const prisma = getPrisma();
  const row = await prisma.integration.findUnique({
    where: { tenantId_provider: { tenantId, provider: PROVIDER } },
  });
  const { consumerKey, consumerSecret } = trayAppCreds();
  const connected = !!row && row.status === "connected" && !!row.accessToken;
  return {
    provider: "tray",
    connected,
    status: row?.status ?? "disconnected",
    storeId: row?.storeId ?? null,
    apiAddress: row?.apiAddress ?? null,
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    accessExpiresAt: row?.accessExpiresAt?.toISOString() ?? null,
    refreshExpiresAt: row?.refreshExpiresAt?.toISOString() ?? null,
    appConfigured: !!consumerKey && !!consumerSecret,
    lastError: row?.lastError ?? null,
  };
}

/** Credencial do connector Tray por tenant (token decifrado) — para injetar no TrayErp. */
export async function getTrayConnectorCreds(tenantId: string): Promise<{ apiUrl: string; accessToken: string } | null> {
  const prisma = getPrisma();
  const row = await prisma.integration.findUnique({
    where: { tenantId_provider: { tenantId, provider: PROVIDER } },
  });
  const accessToken = decryptPII(row?.accessToken);
  if (!row?.apiAddress || !accessToken || row.status !== "connected") return null;
  return { apiUrl: row.apiAddress, accessToken };
}
