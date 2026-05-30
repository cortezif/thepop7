import { PrismaClient, Prisma } from "@prisma/client";
import { decryptPII } from "./pii-crypto.js";

export * from "@prisma/client";
export * from "./pii-crypto.js";

let _prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    // `query` (dev) vai pro STDOUT — proibido em processos que usam stdout como
    // canal (ex.: servidor MCP sobre stdio). Esses setam PRISMA_DISABLE_QUERY_LOG=true.
    const logQuery = process.env.NODE_ENV === "development" && process.env.PRISMA_DISABLE_QUERY_LOG !== "true";
    _prisma = new PrismaClient({
      log: logQuery ? ["query", "warn", "error"] : ["warn", "error"],
    });
  }
  return _prisma;
}

/**
 * Executes `fn` inside a transaction where Postgres `app.current_tenant_id`
 * is set to `tenantId`. RLS policies in rls.sql use this setting to filter
 * every row read or written.
 *
 * Use this wrapper for EVERY request scoped to a tenant.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${tenantId.replace(/'/g, "''")}'`);
    return fn(tx);
  });
}

/**
 * Credencial Tray do tenant (token decifrado) pra injetar no connector ERP.
 * `null` se a loja não conectou a Tray (ou o token foi removido). Compartilhado
 * por api e worker (ambos resolvem o ERP por tenant via `buildErpForTenant`).
 */
export async function getTrayCreds(
  tenantId: string
): Promise<{ apiUrl: string; accessToken: string } | null> {
  const row = await getPrisma().integration.findUnique({
    where: { tenantId_provider: { tenantId, provider: "tray" } },
  });
  const accessToken = decryptPII(row?.accessToken);
  if (!row?.apiAddress || !accessToken || row.status !== "connected") return null;
  return { apiUrl: row.apiAddress, accessToken };
}

/**
 * Credenciais de app salvas no painel POR LOJA (Integration.appConfig), por
 * provider, já decifradas. Formato: { provider: { campo: valor } }. Usado para
 * popular o contexto de credenciais (runWithCredentials/enterCredentials) em
 * api e worker, para que connectors/agent usem a credencial da loja em runtime.
 * Só inclui o que está salvo no banco — env continua sendo o fallback.
 */
export async function resolveTenantCredentials(
  tenantId: string
): Promise<Record<string, Record<string, string>>> {
  const rows = await getPrisma().integration.findMany({ where: { tenantId } });
  const out: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    const raw = decryptPII(row.appConfig);
    if (!raw) continue;
    try {
      const cfg = JSON.parse(raw) as Record<string, string>;
      if (cfg && typeof cfg === "object" && Object.keys(cfg).length) out[row.provider] = cfg;
    } catch { /* ignora json inválido */ }
  }
  return out;
}
