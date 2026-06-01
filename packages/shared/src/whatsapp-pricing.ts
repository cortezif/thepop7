// Economia de WhatsApp (Cloud API) — janela de atendimento + classificação de
// custo das mensagens de SAÍDA.
//
// Regra de cobrança da Meta (modelo por mensagem, 2024+):
//   • Dentro da "janela de atendimento" (24h desde a ÚLTIMA mensagem recebida
//     do cliente) a loja pode responder com mensagem de sessão (texto livre)
//     SEM custo de template → categoria "service" (grátis).
//   • Fora da janela, só é possível enviar TEMPLATE aprovado, e isso é PAGO.
//     O preço varia pela categoria do template: utility < authentication <
//     marketing (valores reais dependem do rate card da conta/país).
//
// Este módulo é puro (sem I/O) para ser testável e reaproveitado nos fluxos
// reativo (conversation-service) e proativos (pós-venda, cashback, winback,
// campanhas).

/** Duração da janela de atendimento do WhatsApp: 24 horas. */
export const WA_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Categoria de custo de uma mensagem de saída. */
export type WaCategory = "service" | "utility" | "marketing" | "authentication";

function toMillis(at?: Date | string | null): number | null {
  if (at == null) return null;
  const t = at instanceof Date ? at.getTime() : new Date(at).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * A janela de atendimento está aberta? `lastInboundAt` é o instante da última
 * mensagem RECEBIDA do cliente (início da janela). Sem mensagem recebida, a
 * janela está fechada (só template pago consegue iniciar contato).
 */
export function waWindowOpen(lastInboundAt?: Date | string | null, now: Date = new Date()): boolean {
  const t = toMillis(lastInboundAt);
  if (t == null) return false;
  return now.getTime() - t < WA_SERVICE_WINDOW_MS;
}

/** Quando a janela expira (lastInbound + 24h), ou null se o cliente nunca escreveu. */
export function waWindowExpiresAt(lastInboundAt?: Date | string | null): Date | null {
  const t = toMillis(lastInboundAt);
  return t == null ? null : new Date(t + WA_SERVICE_WINDOW_MS);
}

/**
 * Classifica uma mensagem de saída para fins de CUSTO:
 *   • janela aberta → "service" (grátis), pois pode ir como mensagem de sessão;
 *   • janela fechada → cai na categoria de template (`intent`), que é PAGA.
 * `intent` default é "utility" (a categoria paga mais barata).
 */
export function classifyOutbound(opts: { windowOpen: boolean; intent?: WaCategory }): WaCategory {
  if (opts.windowOpen) return "service";
  return opts.intent ?? "utility";
}

/**
 * Tabela de preço por categoria (BRL/mensagem). Configurável por env para
 * refletir o rate card real da conta Meta. "service" é sempre 0. Os defaults
 * são APROXIMAÇÕES da tabela BR — ajuste via WA_PRICE_*_BRL para números reais.
 */
export function waPriceTableBRL(): Record<WaCategory, number> {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  return {
    service: 0,
    utility: num(process.env.WA_PRICE_UTILITY_BRL, 0.04),
    marketing: num(process.env.WA_PRICE_MARKETING_BRL, 0.34),
    authentication: num(process.env.WA_PRICE_AUTH_BRL, 0.2),
  };
}

/** Custo estimado (BRL) de uma mensagem na categoria dada. */
export function waCostBRL(category: WaCategory): number {
  return waPriceTableBRL()[category];
}
