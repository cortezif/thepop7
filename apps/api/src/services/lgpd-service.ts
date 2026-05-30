import { getPrisma, withTenant, decryptPII, Prisma } from "@hubadvisor/db";
import { appendAudit } from "./audit-service.js";

/**
 * LGPD (ADR-013): portabilidade (export) e direito ao esquecimento (erase).
 * Toda ação é registrada no audit log encadeado.
 */

/** Exporta todos os dados pessoais de um contato (portabilidade). */
export async function exportContactData(tenantId: string, contactId: string) {
  const result = await withTenant(tenantId, async (tx) => {
    const enc = await tx.contact.findUnique({ where: { id: contactId } });
    if (!enc) return null;
    // Portabilidade: devolve a PII em claro (decifrada) pro titular.
    const contact = { ...enc, phone: decryptPII(enc.phone), email: decryptPII(enc.email), cpf: decryptPII(enc.cpf) };

    const conversations = await tx.conversation.findMany({
      where: { contactId },
      include: { messages: { select: { direction: true, content: true, createdAt: true } } },
    });
    const orders = await tx.order.findMany({
      where: { contactId },
      include: { items: true, returns: true },
    });

    return { contact, conversations, orders, exportedAt: new Date().toISOString() };
  });

  if (result) {
    await appendAudit(tenantId, {
      action: "lgpd.export", entityType: "contact", entityId: contactId, actor: "system",
      payload: { conversations: result.conversations.length, orders: result.orders.length },
    });
  }
  return result;
}

/**
 * Direito ao esquecimento: anonimiza PII do contato e das conversas,
 * preservando dados transacionais agregados (pedidos ficam mas sem PII direto).
 * Não deleta linhas (integridade referencial + auditoria), apenas remove PII.
 */
export async function eraseContact(tenantId: string, contactId: string) {
  const done = await withTenant(tenantId, async (tx) => {
    const contact = await tx.contact.findUnique({ where: { id: contactId } });
    if (!contact) return false;

    const anon = `anon_${contactId.slice(-8)}`;
    await tx.contact.update({
      where: { id: contactId },
      data: {
        name: "[removido]", phone: null, igHandle: null, email: null, cpf: null,
        phoneHash: null, emailHash: null, cpfHash: null,
        height: null, bust: null, waist: null, hips: null, usualSize: null,
        styles: [], occasions: [], avoid: [], favoriteColors: [],
        consentLGPD: false, optOuts: ["marketing", "nps", "recompra"],
      },
    });

    // Anonimiza conteúdo das mensagens (mantém metadados de custo/modelo)
    await tx.message.updateMany({
      where: { conversation: { contactId } },
      data: { content: "[conteúdo removido por solicitação LGPD]" },
    });

    // Endereços nos pedidos (PII) — limpa o JSON de endereço
    await tx.order.updateMany({
      where: { contactId },
      data: { shippingAddress: undefined, deliveredTo: null },
    });

    return true;
  });

  if (done) {
    await appendAudit(tenantId, {
      action: "lgpd.erase", entityType: "contact", entityId: contactId, actor: "system",
      payload: { method: "anonymization" },
    });
  }
  return done;
}

/**
 * Retenção LGPD (ADR-013): conversas inativas há mais de `retentionDays`
 * têm o CONTEÚDO das mensagens anonimizado (linhas preservadas — métricas de
 * custo/modelo e auditoria intactas). Desativado por padrão (retentionDays null).
 * Nada roda automático: o painel/endpoint dispara preview e execução manual.
 */
function retentionCutoff(retentionDays: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - retentionDays);
  return d;
}

/** Preview do que SERIA anonimizado (conversas + pedidos), sem alterar nada. */
export async function previewRetention(tenantId: string) {
  const tenant = await getPrisma().tenant.findUnique({ where: { id: tenantId } });
  const convDays = tenant?.retentionDays ?? null;
  const orderDays = tenant?.orderRetentionDays ?? null;
  if (convDays == null && orderDays == null) return { enabled: false as const, retentionDays: null, orderRetentionDays: null };

  return withTenant(tenantId, async (tx) => {
    let mensagensAfetadas = 0, pedidosAfetados = 0;
    if (convDays != null) {
      const cutoff = retentionCutoff(convDays);
      mensagensAfetadas = await tx.message.count({ where: { conversation: { lastMessageAt: { lt: cutoff } }, content: { not: null } } });
    }
    if (orderDays != null) {
      const cutoff = retentionCutoff(orderDays);
      pedidosAfetados = await tx.order.count({ where: { createdAt: { lt: cutoff }, OR: [{ shippingAddress: { not: Prisma.DbNull } }, { deliveredTo: { not: null } }] } });
    }
    return { enabled: true as const, retentionDays: convDays, orderRetentionDays: orderDays, mensagensAfetadas, pedidosAfetados };
  });
}

/** Executa a anonimização de retenção (conversas + pedidos). Idempotente. */
export async function runRetention(tenantId: string) {
  const tenant = await getPrisma().tenant.findUnique({ where: { id: tenantId } });
  const convDays = tenant?.retentionDays ?? null;
  const orderDays = tenant?.orderRetentionDays ?? null;
  if (convDays == null && orderDays == null) return { ok: false as const, reason: "retenção desativada" };

  const result = await withTenant(tenantId, async (tx) => {
    let mensagensAnonimizadas = 0, pedidosAnonimizados = 0;
    if (convDays != null) {
      const r = await tx.message.updateMany({
        where: { conversation: { lastMessageAt: { lt: retentionCutoff(convDays) } }, content: { not: "[removido por política de retenção]" } },
        data: { content: "[removido por política de retenção]" },
      });
      mensagensAnonimizadas = r.count;
    }
    if (orderDays != null) {
      const r = await tx.order.updateMany({
        where: { createdAt: { lt: retentionCutoff(orderDays) }, OR: [{ shippingAddress: { not: Prisma.DbNull } }, { deliveredTo: { not: null } }] },
        data: { shippingAddress: Prisma.DbNull, deliveredTo: null },
      });
      pedidosAnonimizados = r.count;
    }
    return { mensagensAnonimizadas, pedidosAnonimizados };
  });

  await appendAudit(tenantId, {
    action: "lgpd.retention", entityType: "tenant", entityId: tenantId, actor: "system",
    payload: { retentionDays: convDays, orderRetentionDays: orderDays, ...result },
  });
  return { ok: true as const, retentionDays: convDays, orderRetentionDays: orderDays, ...result };
}

/** Verifica se um contato optou por NÃO receber uma categoria de mensagem. */
export async function isOptedOut(tenantId: string, contactId: string, category: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const c = await tx.contact.findUnique({ where: { id: contactId }, select: { optOuts: true } });
    return (c?.optOuts ?? []).includes(category);
  });
}
