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
 * Papel de banco SEM superuser/BYPASSRLS pro qual cada transação tenant-scoped
 * "desce" (hardening do RLS — ADR-002). Definido pela env `APP_DB_ROLE` (em prod:
 * `hubadvisor_app`, criado pelo rls.sql). Vazio = comportamento legado (roda como
 * o usuário da conexão, ex. postgres, que bypassa o RLS — só a checagem no código
 * isola). Validar a env uma vez (identificador SQL simples) pra poder interpolar.
 */
const APP_DB_ROLE = (() => {
  const r = process.env.APP_DB_ROLE?.trim();
  if (!r) return null;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(r)) throw new Error(`APP_DB_ROLE inválido: ${r}`);
  return r;
})();

/**
 * Executes `fn` inside a transaction where Postgres `app.current_tenant_id`
 * is set to `tenantId`. RLS policies in rls.sql use this setting to filter
 * every row read or written.
 *
 * Quando `APP_DB_ROLE` está definido, a transação ainda baixa para esse papel
 * (NOBYPASSRLS) via `SET LOCAL ROLE` — então o RLS isola de fato, mesmo que um
 * `where tenantId` seja esquecido no código. O `SET LOCAL` é revertido no fim da
 * transação (a conexão volta ao pool como o usuário original). A ordem importa:
 * setamos o GUC ANTES de baixar o papel (e o GUC é local à transação).
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
    if (APP_DB_ROLE) await tx.$executeRawUnsafe(`SET LOCAL ROLE "${APP_DB_ROLE}"`);
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
 * Credencial Bling do tenant (token OAuth decifrado) pra injetar no connector ERP
 * quando ERP_PROVIDER=bling. `null` se a loja não conectou a Bling. A base da API
 * é fixa (api.bling.com.br/Api/v3), então só o access_token é necessário.
 */
export async function getBlingCreds(
  tenantId: string
): Promise<{ accessToken: string } | null> {
  const row = await getPrisma().integration.findUnique({
    where: { tenantId_provider: { tenantId, provider: "bling" } },
  });
  const accessToken = decryptPII(row?.accessToken);
  if (!accessToken || row?.status !== "connected") return null;
  return { accessToken };
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
