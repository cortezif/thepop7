import { getPrisma, withTenant } from "@hubadvisor/db";
import { normalizeBarcode } from "@hubadvisor/shared";

// Conferência de envio por scan (barcode F3). O operador bipa os itens ao embalar;
// reconciliamos contra o pedido. A reconciliação é função pura (testável).

export type PickingExpected = { variantSku: string; barcode: string; quantity: number };
export type PickingResult = {
  items: Array<{ variantSku: string; barcode: string; expected: number; conferred: number; missing: number }>;
  extras: Array<{ barcode: string; count: number }>;
  complete: boolean;
};

/** Reconcilia os códigos bipados contra os itens esperados do pedido. Pura. */
export function reconcilePicking(expected: PickingExpected[], scanned: string[]): PickingResult {
  const scanCount = new Map<string, number>();
  for (const raw of scanned) {
    const b = normalizeBarcode(raw);
    if (b) scanCount.set(b, (scanCount.get(b) ?? 0) + 1);
  }
  const items = expected.map((e) => {
    const got = scanCount.get(e.barcode) ?? 0;
    const conferred = Math.min(got, e.quantity);
    // consome os bipados desse código (sobra vira "extra")
    scanCount.set(e.barcode, Math.max(0, got - e.quantity));
    return { variantSku: e.variantSku, barcode: e.barcode, expected: e.quantity, conferred, missing: e.quantity - conferred };
  });
  const extras = [...scanCount.entries()].filter(([, c]) => c > 0).map(([barcode, count]) => ({ barcode, count }));
  const complete = items.every((i) => i.missing === 0) && extras.length === 0;
  return { items, extras, complete };
}

/** Lista de separação de um pedido: itens + código de barras + qtd. */
export async function getPickingList(tenantId: string, orderId: string) {
  const prisma = getPrisma();
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: { items: { include: { product: { select: { name: true } } } } },
  });
  if (!order) return null;
  const barcodes = await prisma.productBarcode.findMany({
    where: { tenantId, variantSku: { in: order.items.map((i) => i.variantSku) } },
  });
  const bySku = new Map(barcodes.map((b) => [b.variantSku, b.barcode]));
  return {
    orderId,
    items: order.items.map((it) => ({
      variantSku: it.variantSku,
      description: it.product.name,
      quantity: it.quantity,
      barcode: bySku.get(it.variantSku) ?? null,
    })),
  };
}

/** Confere os bipados; registra evento de conferência. Não muda estoque (já baixado na venda). */
export async function confirmPicking(tenantId: string, orderId: string, scanned: string[]): Promise<PickingResult & { ok: boolean }> {
  const list = await getPickingList(tenantId, orderId);
  if (!list) return { ok: false, items: [], extras: [], complete: false };
  const expected: PickingExpected[] = list.items
    .filter((i) => i.barcode)
    .map((i) => ({ variantSku: i.variantSku, barcode: i.barcode!, quantity: i.quantity }));
  const result = reconcilePicking(expected, scanned);
  await withTenant(tenantId, async (tx) => {
    await tx.domainEvent.create({
      data: {
        tenantId, type: result.complete ? "picking.confirmed" : "picking.partial",
        aggregateType: "order", aggregateId: orderId,
        payload: { complete: result.complete, missing: result.items.filter((i) => i.missing > 0).length } as any,
        actor: "operator",
      },
    });
  });
  return { ok: true, ...result };
}
