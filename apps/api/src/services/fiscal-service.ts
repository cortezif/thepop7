import { getPrisma, withTenant, decryptPII } from "@thepop/db";
import { getFiscalConnector } from "@thepop/connectors";
import type { NfeInput } from "@thepop/connectors";

/**
 * Emite a NF-e de um pedido (ADR-023/CPlug). Acionado na transição → `paid`.
 *
 * - Idempotente: se o pedido já tem `nfeNumber`, não reemite.
 * - Gracioso: falha na emissão NÃO desfaz o pagamento — registra evento
 *   `nfe.failed` e segue (a nota pode ser reemitida manualmente). Em dev sem
 *   credencial, o failover cai no MockFiscal (ADR-022), então emite mock.
 * - Fora da transação de pagamento (efeito externo, pode levar segundos).
 */
export async function issueNfeForOrder(tenantId: string, orderId: string): Promise<
  { ok: true; number: string } | { ok: false; reason: string; skipped?: boolean }
> {
  const prisma = getPrisma();
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      contact: true,
      items: { include: { product: { select: { name: true } } } },
    },
  });
  if (!order) return { ok: false, reason: "pedido não encontrado" };
  if (order.nfeNumber) return { ok: false, reason: "NF-e já emitida", skipped: true };

  const addr = (order.shippingAddress as Record<string, string> | null) ?? {};
  const input: NfeInput = {
    orderId: order.id,
    customer: {
      name: order.contact.name ?? "Consumidor",
      document: decryptPII(order.contact.cpf) ?? "", // CPF (vazio = consumidor não identificado)
      email: decryptPII(order.contact.email) ?? undefined,
      address: { ...addr, zip: order.shippingZip ?? addr.zip ?? "" },
    },
    items: order.items.map((it) => ({
      description: it.product.name,
      sku: it.variantSku,
      quantity: it.quantity,
      unitPriceBRL: Number(it.unitPriceBRL),
    })),
    totalBRL: Number(order.totalBRL),
  };

  try {
    const nfe = await getFiscalConnector().issueNfe(input);
    await withTenant(tenantId, async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { nfeNumber: nfe.number, nfeXmlUrl: nfe.xmlUrl || null, nfePdfUrl: nfe.pdfUrl || null },
      });
      await tx.domainEvent.create({
        data: { tenantId, type: "nfe.issued", aggregateType: "order", aggregateId: orderId, payload: { number: nfe.number } as any, actor: "system" },
      });
    });
    return { ok: true, number: nfe.number };
  } catch (e: any) {
    const reason = e?.message ?? String(e);
    await withTenant(tenantId, async (tx) => {
      await tx.domainEvent.create({
        data: { tenantId, type: "nfe.failed", aggregateType: "order", aggregateId: orderId, payload: { reason } as any, actor: "system" },
      });
    });
    return { ok: false, reason };
  }
}
