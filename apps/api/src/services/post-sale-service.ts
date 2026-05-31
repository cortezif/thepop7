import { getPrisma, withTenant, resolveTenantCredentials } from "@hubadvisor/db";
import { getMessagingConnector } from "@hubadvisor/connectors";
import { generatePostSaleMessage, type PostSaleStage } from "@hubadvisor/agent";
import { returnDeadline, EVENTS, enterCredentials } from "@hubadvisor/shared";

// Categoria de opt-out por estágio (LGPD — ADR-013).
// D+1/D+7 são transacionais (entrega/prazo legal) — sempre enviados.
// D+14 (NPS) e D+30 (recompra/marketing) respeitam opt-out.
const STAGE_OPTOUT: Partial<Record<PostSaleStage, string>> = {
  d14: "nps",
  d30: "recompra",
};

/**
 * Sufixo determinístico com a NF-e, anexado no D+1 (documento fiscal não pode
 * depender do LLM). Vazio fora do D+1 ou se a nota não foi emitida. Função pura.
 */
export function nfeSuffix(stage: PostSaleStage, nfeNumber?: string | null, nfePdfUrl?: string | null): string {
  if (stage !== "d1" || !nfeNumber) return "";
  return `\n\n🧾 Sua nota fiscal (NF-e ${nfeNumber}) já está emitida` + (nfePdfUrl ? `: ${nfePdfUrl}` : ".");
}

/**
 * Dispara um marco de pós-venda (Lia) para um pedido entregue.
 * Gera a mensagem proativa, persiste na conversa do contato e envia no canal.
 *
 * Em produção isto é chamado por job agendado (BullMQ delayed) acionado pelo
 * evento order.delivered. Sem Redis, pode ser disparado manualmente via API.
 */
export async function runPostSaleStage(tenantId: string, orderId: string, stage: PostSaleStage) {
  const prisma = getPrisma();
  enterCredentials(await resolveTenantCredentials(tenantId));

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error("tenant não encontrado");

  // 1) Lê o pedido (tx curta de leitura).
  const order = await withTenant(tenantId, async (tx) =>
    tx.order.findFirst({
      where: { id: orderId, tenantId },
      include: { contact: true, items: { include: { product: { select: { name: true } } } } },
    }),
  );
  if (!order) throw new Error("pedido não encontrado");

  // 2) Enforcement de opt-out (LGPD): não envia esta categoria se o cliente optou por sair.
  const optCategory = STAGE_OPTOUT[stage];
  if (optCategory && (order.contact.optOuts ?? []).includes(optCategory)) {
    return { stage, skipped: true as const, reason: `cliente optou por não receber "${optCategory}"` };
  }

  // 3) Gera a mensagem (LLM) FORA da transação — não segura conexão por segundos (ADR-022).
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
  // Anexa a NF-e no D+1 (documento fiscal → determinístico, não depende do LLM).
  const messageText = generated.text + nfeSuffix(stage, order.nfeNumber, order.nfePdfUrl);

  // 4) Persiste (tx curta de escrita): conversa + mensagem + evento.
  const conversationId = await withTenant(tenantId, async (tx) => {
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
        conversationId: conversation.id, direction: "out", type: "text", content: messageText,
        llmModel: process.env.CLAUDE_MODEL_FAST ?? "claude-haiku-4-5-20251001",
        llmInputTokens: generated.usage.inputTokens, llmOutputTokens: generated.usage.outputTokens,
      },
    });
    await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
    await tx.domainEvent.create({
      data: {
        tenantId,
        type: EVENTS[`POSTSALE_${stage.toUpperCase()}` as keyof typeof EVENTS] ?? `postsale.${stage}`,
        aggregateType: "order", aggregateId: orderId, payload: { stage } as any, actor: "agent",
      },
    });
    return conversation.id;
  });

  // 5) Envia no canal FORA da transação (efeito externo).
  await getMessagingConnector().send({ tenantId, conversationId, type: "text", text: messageText });

  return { stage, message: messageText, conversationId };
}
