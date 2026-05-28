import { getPrisma, withTenant, encryptPII, decryptPII, hashPII, type Prisma } from "@thepop/db";
import { getPaymentConnector, getFiscalConnector, getLogisticsConnector } from "@thepop/connectors";
import {
  canCancelOrder, canRequestReturn, canTransitionOrder,
  returnDeadline, EVENTS, type OrderStatus,
} from "@thepop/shared";

/**
 * Cria pedido a partir de itens + endereço, gera cobrança PIX e devolve
 * os dados pro agente apresentar ao cliente. Converte reservas em baixa
 * só após pagamento (via webhook, não aqui).
 */
type CreateOrderResult =
  | { orderId: string; totalBRL: number; subtotalBRL: number; shippingBRL: number; pendingApproval: true }
  | { orderId: string; totalBRL: number; subtotalBRL: number; shippingBRL: number; pix: { qrCode?: string; qrCodeBase64?: string; expiresAt?: string } };

export async function createOrder(input: {
  tenantId: string;
  contactId: string;
  items: Array<{ productId: string; variantSku: string; quantity: number; unitPriceBRL: number }>;
  shippingZip: string;
  shippingBRL: number;
  carrier?: string;
  // Auto-aprovação (ADR-025): quando true, cria o pedido SEM gerar PIX e o marca
  // como pendente de aprovação humana. O PIX sai depois via approveOrder().
  pendingApproval?: boolean;
}): Promise<CreateOrderResult> {
  return withTenant(input.tenantId, async (tx) => {
    const subtotal = input.items.reduce((s, i) => s + i.unitPriceBRL * i.quantity, 0);
    const total = subtotal + input.shippingBRL;

    const order = await tx.order.create({
      data: {
        tenantId: input.tenantId,
        contactId: input.contactId,
        status: "created",
        shippingZip: input.shippingZip,
        subtotalBRL: subtotal,
        shippingBRL: input.shippingBRL,
        totalBRL: total,
        carrier: input.carrier,
        metadata: input.pendingApproval ? { pendingApproval: true } : undefined,
        items: {
          create: input.items.map((i) => ({
            productId: i.productId,
            variantSku: i.variantSku,
            quantity: i.quantity,
            unitPriceBRL: i.unitPriceBRL,
          })),
        },
      },
    });

    await tx.domainEvent.create({
      data: { tenantId: input.tenantId, type: EVENTS.ORDER_CREATED, aggregateType: "order", aggregateId: order.id, payload: { total, pendingApproval: !!input.pendingApproval }, actor: "agent" },
    });

    // Pendente de aprovação: não gera PIX agora.
    if (input.pendingApproval) {
      return { orderId: order.id, totalBRL: total, subtotalBRL: subtotal, shippingBRL: input.shippingBRL, pendingApproval: true as const };
    }

    // Gera cobrança PIX (mock em dev)
    const contact = await tx.contact.findUnique({ where: { id: input.contactId } });
    const charge = await getPaymentConnector().createCharge({
      amountBRL: total,
      description: `Pedido ${order.id.slice(-6)}`,
      method: "pix",
      customer: { name: contact?.name ?? "Cliente", phone: decryptPII(contact?.phone) ?? undefined },
      externalReference: order.id,
      expiresInMinutes: 30,
    });

    await tx.order.update({
      where: { id: order.id },
      data: { paymentMethod: "pix", paymentExternalId: charge.externalId },
    });

    return {
      orderId: order.id,
      totalBRL: total,
      subtotalBRL: subtotal,
      shippingBRL: input.shippingBRL,
      pix: { qrCode: charge.pixQrCode, qrCodeBase64: charge.pixQrCodeBase64, expiresAt: charge.expiresAt },
    };
  });
}

/**
 * Aprova um pedido que estava pendente de aprovação humana (ADR-025): gera o
 * PIX e limpa a flag. Idempotente o suficiente — só age se ainda estiver pendente.
 */
export async function approveOrder(tenantId: string, orderId: string) {
  return withTenant(tenantId, async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) return { ok: false, reason: "pedido não encontrado" };
    const meta = (order.metadata as Record<string, unknown> | null) ?? {};
    if (!meta.pendingApproval) return { ok: false, reason: "pedido não está pendente de aprovação" };

    const contact = await tx.contact.findUnique({ where: { id: order.contactId } });
    const charge = await getPaymentConnector().createCharge({
      amountBRL: Number(order.totalBRL),
      description: `Pedido ${order.id.slice(-6)}`,
      method: "pix",
      customer: { name: contact?.name ?? "Cliente", phone: decryptPII(contact?.phone) ?? undefined },
      externalReference: order.id,
      expiresInMinutes: 30,
    });

    const { pendingApproval, ...restMeta } = meta;
    await tx.order.update({
      where: { id: order.id },
      data: { paymentMethod: "pix", paymentExternalId: charge.externalId, metadata: restMeta as any },
    });
    await tx.domainEvent.create({
      data: { tenantId, type: "order.approved", aggregateType: "order", aggregateId: order.id, payload: { total: Number(order.totalBRL) } as any, actor: "operator" },
    });

    return { ok: true, orderId: order.id, totalBRL: Number(order.totalBRL), pix: { qrCode: charge.pixQrCode, expiresAt: charge.expiresAt } };
  });
}

/** Transição genérica validada pela máquina de estados. */
export async function transitionOrder(tenantId: string, orderId: string, to: OrderStatus, meta?: Record<string, unknown>) {
  const prisma = getPrisma();
  return withTenant(tenantId, async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("pedido não encontrado");
    if (!canTransitionOrder(order.status as OrderStatus, to)) {
      throw new Error(`Transição inválida: ${order.status} → ${to}`);
    }
    const data: any = { status: to, ...meta };
    if (to === "paid") data.paidAt = new Date();
    if (to === "shipped") data.shippedAt = new Date();
    if (to === "delivered") data.deliveredAt = new Date();

    await tx.order.update({ where: { id: orderId }, data });

    // Baixa de estoque na confirmação de pagamento (ADR-009/011): converte
    // a reserva em baixa real e decrementa o stock da variante no catálogo.
    if (to === "paid" && order.status !== "paid") {
      await consumeStockForOrder(tx, tenantId, orderId, order.contactId);
    }

    await tx.domainEvent.create({
      data: { tenantId, type: `order.${to}`, aggregateType: "order", aggregateId: orderId, payload: (meta ?? {}) as any, actor: "system" },
    });
    return { ok: true, status: to };
  });
}

/**
 * Converte reservas em baixa de estoque para os itens de um pedido pago.
 * Decrementa o stock da variante no JSON do produto e marca as reservas
 * ativas do contato (para os SKUs do pedido) como `converted`. Idempotente
 * via guard no chamador (só roda na transição created/...→paid).
 */
async function consumeStockForOrder(tx: Prisma.TransactionClient, tenantId: string, orderId: string, contactId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  for (const it of items) {
    const product = await tx.product.findUnique({ where: { id: it.productId } });
    if (!product) continue;
    const variants = (product.variants as Array<{ sku: string; stock: number; [k: string]: unknown }>) ?? [];
    let changed = false;
    for (const v of variants) {
      if (v.sku === it.variantSku) {
        v.stock = Math.max(0, (Number(v.stock) || 0) - it.quantity);
        changed = true;
      }
    }
    if (changed) {
      await tx.product.update({ where: { id: product.id }, data: { variants: variants as any } });
    }
  }
  // Marca reservas ativas do contato (dos SKUs do pedido) como convertidas.
  const skus = items.map((i) => i.variantSku);
  await tx.stockReservation.updateMany({
    where: { tenantId, contactId, variantSku: { in: skus }, status: "active" },
    data: { status: "converted" },
  });
}

/** Cancelamento — só permitido antes da postagem (CDC). */
export async function cancelOrder(tenantId: string, orderId: string, reason: string) {
  const prisma = getPrisma();
  return withTenant(tenantId, async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("pedido não encontrado");
    if (!canCancelOrder(order.status as OrderStatus)) {
      return { ok: false, reason: `Pedido em "${order.status}" não pode ser cancelado (já postado). Use devolução.` };
    }
    await tx.order.update({ where: { id: orderId }, data: { status: "canceled", canceledAt: new Date(), cancelReason: reason } });
    // Libera reservas ativas do contato
    await tx.stockReservation.updateMany({
      where: { tenantId, contactId: order.contactId, status: "active" },
      data: { status: "released" },
    });
    await tx.domainEvent.create({
      data: { tenantId, type: EVENTS.ORDER_CANCELED, aggregateType: "order", aggregateId: orderId, payload: { reason }, actor: "agent" },
    });
    return { ok: true };
  });
}

/** Inicia devolução — valida prazo CDC. */
export async function startReturn(tenantId: string, orderId: string, reason: string, prazoDias = 7) {
  const prisma = getPrisma();
  return withTenant(tenantId, async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("pedido não encontrado");
    if (!canRequestReturn(order.status as OrderStatus, order.deliveredAt, prazoDias)) {
      return { ok: false, reason: `Fora do prazo de devolução (${prazoDias} dias úteis) ou pedido ainda não entregue.` };
    }
    const ret = await tx.return.create({
      data: { orderId, status: "requested", reason },
    });
    await tx.domainEvent.create({
      data: { tenantId, type: EVENTS.RETURN_REQUESTED, aggregateType: "order", aggregateId: orderId, payload: { returnId: ret.id, reason }, actor: "agent" },
    });
    return { ok: true, returnId: ret.id };
  });
}

/** Lista pedidos pro painel — com contato, itens e timeline de eventos (Lia). */
export async function listOrders(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const orders = await tx.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        contact: { select: { name: true, phone: true } },
        items: { include: { product: { select: { name: true } } } },
        returns: true,
      },
    });

    const ids = orders.map((o) => o.id);
    const events = ids.length
      ? await tx.domainEvent.findMany({
          where: { tenantId, aggregateType: "order", aggregateId: { in: ids } },
          orderBy: { createdAt: "asc" },
          select: { aggregateId: true, type: true, actor: true, createdAt: true },
        })
      : [];

    return orders.map((o) => ({
      id: o.id,
      status: o.status,
      contactName: o.contact.name ?? decryptPII(o.contact.phone) ?? "Cliente",
      totalBRL: Number(o.totalBRL),
      carrier: o.carrier,
      trackingCode: o.trackingCode,
      deliveredAt: o.deliveredAt,
      deliveredTo: o.deliveredTo,
      createdAt: o.createdAt,
      returnable: canRequestReturn(o.status as OrderStatus, o.deliveredAt),
      pendingApproval: !!((o.metadata as Record<string, unknown> | null)?.pendingApproval),
      items: o.items.map((i) => ({ name: i.product.name, variantSku: i.variantSku, quantity: i.quantity })),
      timeline: events
        .filter((e) => e.aggregateId === o.id)
        .map((e) => ({ type: e.type, actor: e.actor, at: e.createdAt })),
    }));
  });
}

/**
 * Cria um pedido de demonstração (contato + primeiro produto com estoque)
 * pra exercitar o ciclo na tela: ver pedido → simular entrega → disparar Lia.
 */
export async function createSampleOrder(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const product = await tx.product.findFirst({ where: { tenantId, active: true } });
    if (!product) throw new Error("nenhum produto cadastrado pra gerar pedido de exemplo");

    const variants = (product.variants as Array<{ sku: string; stock: number }>) ?? [];
    const variant = variants.find((v) => v.stock > 0) ?? variants[0];
    if (!variant) throw new Error("produto sem variantes");

    const samplePhone = "+5562999990000";
    let contact = await tx.contact.findFirst({ where: { tenantId, phoneHash: hashPII(samplePhone) } });
    if (!contact) {
      contact = await tx.contact.create({
        data: { tenantId, name: "Joana Cliente", phone: encryptPII(samplePhone), phoneHash: hashPII(samplePhone), preferredChannel: "whatsapp", consentLGPD: true },
      });
    }

    const unit = Number(product.priceBRL);
    const order = await tx.order.create({
      data: {
        tenantId,
        contactId: contact.id,
        status: "created",
        shippingZip: "74000000",
        carrier: "Correios",
        subtotalBRL: unit,
        shippingBRL: 19.9,
        totalBRL: unit + 19.9,
        paymentMethod: "pix",
        items: { create: [{ productId: product.id, variantSku: variant.sku, quantity: 1, unitPriceBRL: unit }] },
      },
    });

    await tx.domainEvent.create({
      data: { tenantId, type: EVENTS.ORDER_CREATED, aggregateType: "order", aggregateId: order.id, payload: { total: unit + 19.9 } as any, actor: "agent" },
    });

    return { orderId: order.id };
  });
}

// Pedidos que já viraram receita (pagos e adiante; exclui não-pagos e cancelados).
const REALIZED_STATUSES: OrderStatus[] = ["paid", "picking", "shipped", "in_transit", "out_for_delivery", "delivered", "finalized"];

// Taxas de gateway por método (fração de 0..1). Sobrescrevíveis em tenant.policies.gatewayFees.
const DEFAULT_GATEWAY_FEES: Record<string, number> = { pix: 0.0099, card: 0.0399, boleto: 0.0199 };

/**
 * Margem real dos pedidos realizados (ADR-017): receita − COGS − frete − taxa de gateway.
 * Frete é tratado como pass-through (cobrado da cliente ≈ pago à transportadora),
 * então a margem líquida é, na prática, subtotal − COGS − gateway. Honestidade > otimismo:
 * pedidos sem custo de produto cadastrado entram com COGS 0 e são sinalizados.
 */
export async function computeFinancials(tenantId: string, gatewayFeesOverride?: Record<string, number>) {
  const fees = { ...DEFAULT_GATEWAY_FEES, ...(gatewayFeesOverride ?? {}) };
  return withTenant(tenantId, async (tx) => {
    const orders = await tx.order.findMany({
      where: { status: { in: REALIZED_STATUSES } },
      include: { items: { include: { product: { select: { costBRL: true } } } } },
    });

    let grossRevenue = 0, subtotal = 0, shipping = 0, cogs = 0, gateway = 0;
    let ordersMissingCost = 0;

    for (const o of orders) {
      grossRevenue += Number(o.totalBRL);
      subtotal += Number(o.subtotalBRL);
      shipping += Number(o.shippingBRL);
      const rate = fees[o.paymentMethod ?? "pix"] ?? fees.pix!;
      gateway += Number(o.totalBRL) * rate;
      let orderHasMissing = false;
      for (const it of o.items) {
        if (it.product.costBRL == null) { orderHasMissing = true; continue; }
        cogs += Number(it.product.costBRL) * it.quantity;
      }
      if (orderHasMissing) ordersMissingCost++;
    }

    // Margem líquida: frete entra como receita e sai como custo (pass-through) → cancela.
    const netMargin = subtotal - cogs - gateway;
    const netMarginPct = subtotal > 0 ? (netMargin / subtotal) * 100 : 0;

    return {
      realizedOrders: orders.length,
      grossRevenueBRL: Number(grossRevenue.toFixed(2)),
      subtotalBRL: Number(subtotal.toFixed(2)),
      shippingBRL: Number(shipping.toFixed(2)),
      cogsBRL: Number(cogs.toFixed(2)),
      gatewayFeesBRL: Number(gateway.toFixed(2)),
      netMarginBRL: Number(netMargin.toFixed(2)),
      netMarginPct: Number(netMarginPct.toFixed(1)),
      ordersMissingCost,
    };
  });
}

const DELIVERED_STATUSES: OrderStatus[] = ["delivered", "finalized"];

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const brl = (n: number) => n.toFixed(2).replace(".", ",");

/**
 * Export contábil dos pedidos em CSV (ADR-017): uma linha por pedido com a
 * quebra financeira (receita, COGS, frete, taxa de gateway, margem). Separador
 * ';' e decimal ',' pra abrir direto no Excel/Sheets em pt-BR.
 */
export async function exportOrdersCSV(tenantId: string, gatewayFeesOverride?: Record<string, number>) {
  const fees = { ...DEFAULT_GATEWAY_FEES, ...(gatewayFeesOverride ?? {}) };
  return withTenant(tenantId, async (tx) => {
    const orders = await tx.order.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        contact: { select: { name: true, phone: true } },
        items: { include: { product: { select: { name: true, costBRL: true } } } },
      },
    });

    const header = [
      "pedido_id", "data", "cliente", "status", "pagamento", "itens",
      "subtotal_BRL", "frete_BRL", "total_BRL", "cogs_BRL", "taxa_gateway_BRL", "margem_liquida_BRL", "margem_pct",
    ];

    const rows = orders.map((o) => {
      const subtotal = Number(o.subtotalBRL);
      const shipping = Number(o.shippingBRL);
      const total = Number(o.totalBRL);
      const cogs = o.items.reduce((s, it) => s + Number(it.product.costBRL ?? 0) * it.quantity, 0);
      const gateway = total * (fees[o.paymentMethod ?? "pix"] ?? fees.pix!);
      const margin = subtotal - cogs - gateway;
      const marginPct = subtotal > 0 ? (margin / subtotal) * 100 : 0;
      const itens = o.items.map((it) => `${it.quantity}x ${it.product.name} (${it.variantSku})`).join(" | ");
      return [
        o.id,
        o.createdAt.toISOString().slice(0, 10),
        o.contact.name ?? decryptPII(o.contact.phone) ?? "Cliente",
        o.status,
        o.paymentMethod ?? "",
        itens,
        brl(subtotal), brl(shipping), brl(total), brl(cogs), brl(gateway), brl(margin), brl(marginPct),
      ];
    });

    const lines = [header, ...rows].map((cols) => cols.map(csvCell).join(";"));
    return "﻿" + lines.join("\r\n"); // BOM pra Excel reconhecer UTF-8
  });
}

/**
 * Funil de conversão (ADR-017): conversa → pedido → pago → entregue.
 * Honesto com os dados do MVP — pedido se liga ao contato, então a etapa
 * "virou pedido" conta contatos com ≥1 pedido sobre o total de conversas.
 */
export async function computeFunnel(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const conversations = await tx.conversation.count();
    const ordersCreated = await tx.order.count();
    const ordersPaid = await tx.order.count({ where: { status: { in: REALIZED_STATUSES } } });
    const ordersDelivered = await tx.order.count({ where: { status: { in: DELIVERED_STATUSES } } });
    const ordersCanceled = await tx.order.count({ where: { status: "canceled" } });

    const pct = (num: number, den: number) => (den > 0 ? Number(((num / den) * 100).toFixed(1)) : 0);

    return {
      stages: [
        { key: "conversas",  label: "Conversas",       count: conversations },
        { key: "pedido",     label: "Viraram pedido",  count: ordersCreated,   rateFromPrev: pct(ordersCreated, conversations) },
        { key: "pago",       label: "Pagaram",         count: ordersPaid,      rateFromPrev: pct(ordersPaid, ordersCreated) },
        { key: "entregue",   label: "Entregues",       count: ordersDelivered, rateFromPrev: pct(ordersDelivered, ordersPaid) },
      ],
      ordersCanceled,
      overallConversionPct: pct(ordersCreated, conversations),
    };
  });
}

/** Status do pedido pro agente comunicar (inclui prazo de devolução). */
export async function getOrderStatus(tenantId: string, orderId: string) {
  return withTenant(tenantId, async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, returns: true },
    });
    if (!order) return null;
    return {
      id: order.id,
      status: order.status,
      totalBRL: Number(order.totalBRL),
      trackingCode: order.trackingCode,
      carrier: order.carrier,
      deliveredAt: order.deliveredAt,
      deliveredTo: order.deliveredTo,
      cancelable: canCancelOrder(order.status as OrderStatus),
      returnable: canRequestReturn(order.status as OrderStatus, order.deliveredAt),
      returnDeadline: order.deliveredAt ? returnDeadline(order.deliveredAt) : null,
      returns: order.returns.map((r) => ({ id: r.id, status: r.status })),
    };
  });
}
