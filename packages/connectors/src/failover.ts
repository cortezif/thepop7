/**
 * Failover + circuit-breaker de conectores (ADR-022): recebe uma cadeia ordenada
 * de implementações do mesmo contrato e devolve um proxy que delega cada chamada.
 * Se um provedor falha com erro recuperável (rede/timeout/5xx), cai pro próximo
 * — um outage de transportadora/gateway/NFe degrada o serviço (ex.: cai pro mock)
 * em vez de derrubar o fluxo.
 *
 * Circuit-breaker: após `failureThreshold` falhas consecutivas, o provedor entra
 * em "circuito aberto" por `cooldownMs` e é PULADO proativamente (não adianta
 * martelar quem está fora) — exceto se for o último recurso da cadeia. Um sucesso
 * fecha o circuito. Estado é por `label`, então persiste entre chamadas da factory.
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

type Breaker = { failures: number; openUntil: number };
const REGISTRY = new Map<string, Breaker[]>();

function breakersFor(key: string, n: number): Breaker[] {
  let arr = REGISTRY.get(key);
  if (!arr || arr.length !== n) {
    arr = Array.from({ length: n }, () => ({ failures: 0, openUntil: 0 }));
    REGISTRY.set(key, arr);
  }
  return arr;
}

/** Limpa o estado de circuito (para testes). */
export function __resetBreakers() { REGISTRY.clear(); }

export function createFailover<T extends object>(
  chain: T[],
  opts: {
    label?: string;
    log?: (msg: string, meta?: unknown) => void;
    isRecoverable?: (e: unknown) => boolean;
    failureThreshold?: number;
    cooldownMs?: number;
    now?: () => number;
  } = {}
): T {
  if (chain.length === 0) throw new Error("createFailover: cadeia vazia");
  const recoverable = opts.isRecoverable ?? isRecoverableConnectorError;
  const threshold = opts.failureThreshold ?? 3;
  const cooldownMs = opts.cooldownMs ?? 30_000;
  const now = opts.now ?? Date.now;
  const label = opts.label ?? "default";
  const tag = `:${label}`;
  const breakers = breakersFor(label, chain.length);

  return new Proxy(chain[0]!, {
    get(_target, prop, receiver) {
      const sample = Reflect.get(chain[0]!, prop, receiver);
      if (typeof sample !== "function") return sample;

      return async (...args: unknown[]) => {
        let lastError: unknown;
        for (let i = 0; i < chain.length; i++) {
          const b = breakers[i]!;
          const isLast = i === chain.length - 1;
          // Circuito aberto → pula proativamente (a menos que seja o último recurso).
          if (b.openUntil > now() && !isLast) {
            opts.log?.(`[failover${tag}] ${String(prop)}: circuito #${i} aberto, pulando`);
            continue;
          }
          try {
            const r = await (chain[i] as any)[prop](...args);
            b.failures = 0; b.openUntil = 0; // sucesso fecha o circuito
            return r;
          } catch (e) {
            lastError = e;
            if (recoverable(e)) {
              b.failures++;
              if (b.failures >= threshold) {
                b.openUntil = now() + cooldownMs;
                opts.log?.(`[failover${tag}] ${String(prop)}: circuito #${i} ABERTO por ${cooldownMs}ms (${b.failures} falhas)`);
              }
            }
            opts.log?.(`[failover${tag}] ${String(prop)} via #${i} falhou: ${(e as Error)?.message ?? e}`);
            if (isLast || !recoverable(e)) throw e;
          }
        }
        throw lastError;
      };
    },
  }) as T;
}
