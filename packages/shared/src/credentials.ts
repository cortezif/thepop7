/* ============================================================
   Contexto de credenciais por loja (AsyncLocalStorage).

   Os connectors (WhatsApp/Instagram/CPlug) e o agent (Anthropic)
   leem a credencial DESTE contexto; se ausente, caem na env var.
   Logo: SEM contexto → comportamento atual (env), zero regressão.

   Quem orquestra um fluxo de uma loja (serviço/worker) envolve a
   execução com `runWithCredentials(creds, fn)` para que as chamadas
   internas usem a credencial daquela loja.
   ============================================================ */

import { AsyncLocalStorage } from "node:async_hooks";

/** provider → { campo: valor } (apenas valores salvos no banco da loja). */
export type TenantCredentials = Record<string, Record<string, string>>;

const als = new AsyncLocalStorage<TenantCredentials>();

/** Executa `fn` com as credenciais da loja disponíveis no contexto. */
export function runWithCredentials<T>(creds: TenantCredentials | null | undefined, fn: () => T): T {
  if (!creds || Object.keys(creds).length === 0) return fn();
  return als.run(creds, fn);
}

/**
 * Fixa as credenciais da loja no contexto assíncrono ATUAL (e descendentes),
 * sem aninhar callback. Ideal no topo de um handler/job, logo após resolver o
 * tenant. Vazio → não faz nada (mantém o fallback de env).
 */
export function enterCredentials(creds: TenantCredentials | null | undefined): void {
  if (!creds || Object.keys(creds).length === 0) return;
  als.enterWith(creds);
}

/** Lê uma credencial do contexto atual (ou undefined se não houver). */
export function credentialFromContext(provider: string, field: string): string | undefined {
  const v = als.getStore()?.[provider]?.[field];
  return v ? v : undefined;
}

/** Resolve credencial: contexto da loja → env var (fallback). */
export function resolveCredential(provider: string, field: string, envVar?: string): string {
  return credentialFromContext(provider, field) ?? (envVar ? process.env[envVar] ?? "" : "");
}
