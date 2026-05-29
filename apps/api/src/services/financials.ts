/**
 * Lógica financeira pura (ADR-017) — separada das queries pra ser testável sem DB.
 * `order-service` busca as linhas e delega o cálculo aqui.
 */

// Taxas de gateway por método (fração de 0..1). Sobrescrevíveis em tenant.policies.gatewayFees.
export const DEFAULT_GATEWAY_FEES: Record<string, number> = { pix: 0.0099, card: 0.0399, boleto: 0.0199 };

type Num = number | { toString(): string } | null | undefined;
const n = (v: Num): number => (v == null ? 0 : Number(v));

export type FinancialOrder = {
  totalBRL: Num;
  subtotalBRL: Num;
  shippingBRL: Num;
  shippingCostBRL?: Num;
  paymentMethod: string | null;
  items: Array<{ quantity: number; product: { costBRL: Num } }>;
};

export type FinancialsSummary = {
  realizedOrders: number;
  grossRevenueBRL: number;
  subtotalBRL: number;
  shippingBRL: number;
  shippingCostBRL: number;
  shippingResultBRL: number;
  cogsBRL: number;
  gatewayFeesBRL: number;
  netMarginBRL: number;
  netMarginPct: number;
  ordersMissingCost: number;
  ordersMissingShippingCost: number;
};

/**
 * Margem real sobre pedidos já realizados: receita − COGS − taxa de gateway +
 * resultado de frete. O resultado de frete = cobrado − pago à transportadora
 * (`shippingCostBRL`); quando o custo não foi informado, assume pass-through
 * (custo = cobrado → resultado 0) e sinaliza. Pedidos com item sem custo entram
 * com COGS 0 e são sinalizados (margem superestimada).
 */
export function summarizeFinancials(orders: FinancialOrder[], fees: Record<string, number> = DEFAULT_GATEWAY_FEES): FinancialsSummary {
  let grossRevenue = 0, subtotal = 0, shipping = 0, shippingCost = 0, cogs = 0, gateway = 0;
  let ordersMissingCost = 0, ordersMissingShippingCost = 0;

  for (const o of orders) {
    grossRevenue += n(o.totalBRL);
    subtotal += n(o.subtotalBRL);
    const charged = n(o.shippingBRL);
    shipping += charged;
    // custo de frete: usa o informado; senão pass-through (custo = cobrado).
    if (o.shippingCostBRL == null) { shippingCost += charged; ordersMissingShippingCost++; }
    else shippingCost += n(o.shippingCostBRL);
    const rate = fees[o.paymentMethod ?? "pix"] ?? fees.pix ?? 0;
    gateway += n(o.totalBRL) * rate;
    let orderHasMissing = false;
    for (const it of o.items) {
      if (it.product.costBRL == null) { orderHasMissing = true; continue; }
      cogs += n(it.product.costBRL) * it.quantity;
    }
    if (orderHasMissing) ordersMissingCost++;
  }

  const shippingResult = shipping - shippingCost;
  const netMargin = subtotal - cogs - gateway + shippingResult;
  const netMarginPct = subtotal > 0 ? (netMargin / subtotal) * 100 : 0;

  return {
    realizedOrders: orders.length,
    grossRevenueBRL: round2(grossRevenue),
    subtotalBRL: round2(subtotal),
    shippingBRL: round2(shipping),
    shippingCostBRL: round2(shippingCost),
    shippingResultBRL: round2(shippingResult),
    cogsBRL: round2(cogs),
    gatewayFeesBRL: round2(gateway),
    netMarginBRL: round2(netMargin),
    netMarginPct: Number(netMarginPct.toFixed(1)),
    ordersMissingCost,
    ordersMissingShippingCost,
  };
}

const round2 = (x: number) => Number(x.toFixed(2));
const pct = (num: number, den: number) => (den > 0 ? Number(((num / den) * 100).toFixed(1)) : 0);

export type FunnelCounts = {
  conversations: number;
  ordersCreated: number;
  ordersPaid: number;
  ordersDelivered: number;
  ordersCanceled: number;
};

/** Funil de conversão: conversa → pedido → pago → entregue, com % a partir da etapa anterior. */
export function buildFunnel(c: FunnelCounts) {
  return {
    stages: [
      { key: "conversas", label: "Conversas",      count: c.conversations },
      { key: "pedido",    label: "Viraram pedido", count: c.ordersCreated,   rateFromPrev: pct(c.ordersCreated, c.conversations) },
      { key: "pago",      label: "Pagaram",        count: c.ordersPaid,      rateFromPrev: pct(c.ordersPaid, c.ordersCreated) },
      { key: "entregue",  label: "Entregues",      count: c.ordersDelivered, rateFromPrev: pct(c.ordersDelivered, c.ordersPaid) },
    ],
    ordersCanceled: c.ordersCanceled,
    overallConversionPct: pct(c.ordersCreated, c.conversations),
  };
}
