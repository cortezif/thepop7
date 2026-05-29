import { PrismaClient, Prisma } from "@prisma/client";
import { decryptPII } from "./pii-crypto.js";

export * from "@prisma/client";
export * from "./pii-crypto.js";

let _prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
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
