import { getPrisma, withTenant } from "@thepop/db";
import { getMessagingConnector } from "@thepop/connectors";
import { generatePostSaleMessage, type PostSaleStage } from "@thepop/agent";
import { returnDeadline, EVENTS } from "@thepop/shared";

// Categoria de opt-out por estágio (LGPD — ADR-013).
// D+1/D+7 são transacionais (entrega/prazo legal) — sempre enviados.
// D+14 (NPS) e D+30 (recompra/marketing) respeitam opt-out.
const STAGE_OPTOUT: Partial<Record<PostSaleStage, string>> = {
  d14: "nps",
  d30: "recompra",
};

/**
 * Dispara um marco de pós-venda (Lia) para um pedido entregue.
 * Gera a mensagem proativa, persiste na conversa do contato e envia no canal.
 *
 * Em produção isto é chamado por job agendado (BullMQ delayed) acionado pelo
 * evento order.delivered. Sem Redis, pode ser disparado manualmente via API.
 */
export async function runPostSaleStage(tenantId: string, orderId: string, stage: PostSaleStage) {
  const prisma = getPrisma();

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error("tenant não encontrado");

  return withTenant(tenantId, async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        contact: true,
        items: { include: { product: { select: { name: true } } } },
      },
    });
    if (!order) throw new Error("pedido não encontrado");

    // Enforcement de opt-out (LGPD): se o cliente optou por não receber
    // esta categoria, não envia e registra o skip.
    const optCategory = STAGE_OPTOUT[stage];
    if (optCategory && (order.contact.optOuts ?? []).includes(optCategory)) {
      return { stage, skipped: true as const, reason: `cliente optou por não receber "${optCategory}"` };
    }

    const productNames = order.items.map((i) => i.product.name);
    const deadline = order.deliveredAt ? returnDeadline(order.deliveredAt) : undefined;

    const generated = await generatePostSaleMessage(stage, {
      personaName: "Lia",
      storeName: tenant.name,
      customerName: order.contact.name ?? undefined,
      productNames,
      deliveredTo: order.deliveredTo ?? undefined,
      returnDeadline: deadline?.toLocaleDateString("pt-BR"),
      tone: tenant.agentTone ?? undefined,
    });

    // Localiza/cria conversa ativa do contato pra anexar a mensagem
    let conversation = await tx.conversation.findFirst({
      where: { contactId: order.contactId, status: { in: ["active", "handed_off"] } },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!conversation) {
      conversation = await tx.conversation.create({
        data: { tenantId, contactId: order.contactId, channel: order.contact.preferredChannel === "instagram" ? "instagram" : "whatsapp" },
      });
    }

    await tx.message.create({
      data: {
        conversationId: conversation.id,
        direction: "out",
        type: "text",
        content: generated.text,
        llmModel: process.env.CLAUDE_MODEL_FAST ?? "claude-haiku-4-5-20251001",
        llmInputTokens: generated.usage.inputTokens,
        llmOutputTokens: generated.usage.outputTokens,
      },
    });
    await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

    await tx.domainEvent.create({
      data: {
        tenantId,
        type: EVENTS[`POSTSALE_${stage.toUpperCase()}` as keyof typeof EVENTS] ?? `postsale.${stage}`,
        aggregateType: "order",
        aggregateId: orderId,
        payload: { stage } as any,
        actor: "agent",
      },
    });

    // Envia no canal (mock em dev)
    await getMessagingConnector().send({
      tenantId, conversationId: conversation.id, type: "text", text: generated.text,
    });

    return { stage, message: generated.text, conversationId: conversation.id };
  });
}
