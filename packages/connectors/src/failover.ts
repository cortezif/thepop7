/**
 * Failover genérico de conectores (ADR-022): recebe uma cadeia ordenada de
 * implementações do mesmo contrato e devolve um proxy que delega cada chamada
 * de método. Se o primeiro falhar com erro recuperável (rede/timeout/5xx),
 * cai pro próximo — assim um outage de transportadora/gateway/NFe degrada o
 * serviço (ex.: cai pro mock) em vez de derrubar o fluxo.
 *
 * Mesma filosofia do cascade de LLM em @thepop/agent.
 */

export function isRecoverableConnectorError(e: unknown): boolean {
  const msg = ((e as Error)?.message ?? "").toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("503") || msg.includes("502") || msg.includes("504") ||
    msg.includes("unavailable")
  );
}

export function createFailover<T extends object>(
  chain: T[],
  opts: { label?: string; log?: (msg: string, meta?: unknown) => void; isRecoverable?: (e: unknown) => boolean } = {}
): T {
  if (chain.length === 0) throw new Error("createFailover: cadeia vazia");
  const recoverable = opts.isRecoverable ?? isRecoverableConnectorError;
  const tag = opts.label ? `:${opts.label}` : "";

  return new Proxy(chain[0]!, {
    get(_target, prop, receiver) {
      const sample = Reflect.get(chain[0]!, prop, receiver);
      if (typeof sample !== "function") return sample;

      return async (...args: unknown[]) => {
        let lastError: unknown;
        for (let i = 0; i < chain.length; i++) {
          try {
            return await (chain[i] as any)[prop](...args);
          } catch (e) {
            lastError = e;
            opts.log?.(`[failover${tag}] ${String(prop)} via #${i} falhou: ${(e as Error)?.message ?? e}`);
            // Esgotou a cadeia, ou erro não recuperável → propaga.
            if (i === chain.length - 1 || !recoverable(e)) throw e;
          }
        }
        throw lastError;
      };
    },
  }) as T;
}
