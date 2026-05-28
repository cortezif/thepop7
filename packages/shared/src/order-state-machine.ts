/* ============================================================
   Máquina de estados de Pedido e Devolução — ADR-011.

   Regras de transição em CÓDIGO (não no prompt do agente). O agente
   CONSULTA o que é permitido; nunca decide sozinho se pode cancelar
   ou devolver. Isso evita alucinação de prazo/regra (risco jurídico
   citado na ADR-020).
   ============================================================ */

export type OrderStatus =
  | "created" | "paid" | "picking" | "shipped"
  | "in_transit" | "out_for_delivery" | "delivered" | "finalized" | "canceled";

export type ReturnStatus =
  | "requested" | "authorized" | "in_transit" | "received"
  | "analyzing" | "refunded" | "rejected";

// Transições permitidas: de → [paras possíveis]
const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  created:          ["paid", "canceled"],
  paid:             ["picking", "canceled"],          // cancelável até postar
  picking:          ["shipped", "canceled"],          // ainda cancelável (não postou)
  shipped:          ["in_transit", "delivered"],      // postou → só devolução depois
  in_transit:       ["out_for_delivery", "delivered"],
  out_for_delivery: ["delivered"],
  delivered:        ["finalized"],                    // devolução é fluxo separado (Return)
  finalized:        [],
  canceled:         [],
};

const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  requested:  ["authorized", "rejected"],
  authorized: ["in_transit", "rejected"],
  in_transit: ["received"],
  received:   ["analyzing"],
  analyzing:  ["refunded", "rejected"],
  refunded:   [],
  rejected:   [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionReturn(from: ReturnStatus, to: ReturnStatus): boolean {
  return RETURN_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Cancelamento livre (sem custo) só antes da postagem — ADR-011 / CDC. */
export function canCancelOrder(status: OrderStatus): boolean {
  return ["created", "paid", "picking"].includes(status);
}

/** Devolução só faz sentido após entrega, dentro do prazo legal. */
export function canRequestReturn(status: OrderStatus, deliveredAt: Date | null, prazoDiasUteis = 7): boolean {
  if (status !== "delivered" && status !== "finalized") return false;
  if (!deliveredAt) return false;
  return businessDaysSince(deliveredAt) <= prazoDiasUteis;
}

/** Dias úteis decorridos desde uma data (aproximação: exclui sáb/dom). */
export function businessDaysSince(from: Date, to: Date = new Date()): number {
  let count = 0;
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** Data limite de devolução (pra comunicar ao cliente — ADR-010 D+7). */
export function returnDeadline(deliveredAt: Date, prazoDiasUteis = 7): Date {
  const d = new Date(deliveredAt);
  let added = 0;
  while (added < prazoDiasUteis) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

export class IllegalTransitionError extends Error {
  constructor(public entity: "order" | "return", public from: string, public to: string) {
    super(`Transição inválida de ${entity}: ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}
