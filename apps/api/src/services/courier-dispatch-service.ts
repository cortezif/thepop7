import { getPrisma, withTenant, decryptPII } from "@hubadvisor/db";
import { buildCourierForTenant, courierProvider, parseLalamoveWebhook } from "@hubadvisor/connectors";
import { geocodeCep } from "./geocode-service.js";
import { getLalamoveCreds, getOpenDeliveryCreds } from "./integration-service.js";
import { getTariff } from "./delivery-service.js";

// Despacho de entregador on-demand (ADR-030) + ingestão de webhook de status.
// O conector (Lalamove/Open Delivery/mock) já faz quote/dispatch/getStatus; aqui
// orquestramos a partir do PEDIDO: geocoda, cota, despacha e persiste a corrida
// em Order (trackingCode = deliveryId; metadata.courier = {provider,trackingUrl,status}).

async function buildCourierFor(tenantId: string) {
  const provider = courierProvider();
  return provider === "opendelivery"
    ? buildCourierForTenant({ provider, openDeliveryCreds: await getOpenDeliveryCreds(tenantId) })
    : buildCourierForTenant({ provider, lalamoveCreds: await getLalamoveCreds(tenantId) });
}

export async function dispatchCourierForOrder(tenantId: string, orderId: string) {
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const order = await prisma.order.findFirst({ where: { id: orderId, tenantId }, include: { contact: true, items: true } });
  if (!order) throw new Error("pedido não encontrado");
  if (!order.shippingZip) throw new Error("pedido sem CEP de entrega");

  const policies = (tenant?.policies as any) ?? {};
  const fromCep = policies.storeZip ?? process.env.STORE_DEFAULT_ZIP ?? "01310-100";
  const [pickup, dropoff] = await Promise.all([geocodeCep(fromCep), geocodeCep(order.shippingZip)]);
  if (!pickup) throw new Error("não consegui geocodificar o CEP da loja (configure em Entrega)");
  if (!dropoff) throw new Error("não consegui geocodificar o CEP do cliente");

  // Modal por volume (proxy: nº de itens vs limite de moto da tarifa).
  const tariff = await getTariff(tenantId);
  const qty = order.items.reduce((s, i) => s + i.quantity, 0);
  const modal: "moto" | "carro" = qty <= tariff.motoVolumeLimit ? "moto" : "carro";

  const courier = await buildCourierFor(tenantId);
  // Cotação fresca (alguns providers exigem o quotationId/stops no dispatch).
  const quote = await courier.quoteCourier({ pickup, dropoff, modal, itemsValueBRL: Number(order.subtotalBRL) });
  const dispatch = await courier.dispatch({
    quote, pickup, dropoff, modal,
    sender: { name: tenant?.name ?? "Loja", phone: policies.storePhone ?? "" },
    recipient: { name: order.contact?.name ?? "Cliente", phone: decryptPII(order.contact?.phone) ?? "" },
    orderRef: order.id,
  });

  await withTenant(tenantId, async (tx) => {
    const meta = { ...((order.metadata as any) ?? {}) };
    meta.courier = { provider: dispatch.provider, deliveryId: dispatch.deliveryId, trackingUrl: dispatch.trackingUrl ?? null, status: dispatch.status, modal };
    await tx.order.update({
      where: { id: order.id },
      data: { trackingCode: dispatch.deliveryId, carrier: order.carrier ?? `Entregador ${modal} (${dispatch.provider})`, metadata: meta as any },
    });
    await tx.domainEvent.create({
      data: { tenantId, type: "courier.dispatched", aggregateType: "order", aggregateId: order.id, payload: { provider: dispatch.provider, deliveryId: dispatch.deliveryId, modal } as any, actor: "operator" },
    });
  });

  return {
    ok: true as const,
    provider: dispatch.provider,
    deliveryId: dispatch.deliveryId,
    status: dispatch.status,
    trackingUrl: dispatch.trackingUrl ?? null,
    priceBRL: dispatch.priceBRL ?? quote.priceBRL,
    modal,
  };
}

/** Ingestão de webhook de status do courier (Lalamove). Atualiza o pedido. */
export async function applyCourierWebhook(payload: unknown) {
  const parsed = parseLalamoveWebhook(payload);
  if (!parsed.deliveryId) return { ok: false as const, reason: "webhook sem deliveryId" };

  const order = await getPrisma().order.findFirst({ where: { trackingCode: parsed.deliveryId } });
  if (!order) return { ok: false as const, reason: "pedido não encontrado para o deliveryId" };

  const meta = { ...((order.metadata as any) ?? {}) };
  meta.courier = { ...(meta.courier ?? {}), status: parsed.status, rawStatus: parsed.rawStatus };
  const data: Record<string, unknown> = { metadata: meta };
  if (parsed.status === "delivered" && !order.deliveredAt) data.deliveredAt = new Date();

  await withTenant(order.tenantId, async (tx) => {
    await tx.order.update({ where: { id: order.id }, data });
    await tx.domainEvent.create({
      data: { tenantId: order.tenantId, type: `courier.${parsed.status}`, aggregateType: "order", aggregateId: order.id, payload: { deliveryId: parsed.deliveryId, rawStatus: parsed.rawStatus } as any, actor: "courier" },
    });
  });

  return { ok: true as const, orderId: order.id, status: parsed.status };
}
