import { getPrisma } from "@thepop/db";

/**
 * Cria um tenant DESCARTÁVEL (slug único), roda o teste com o tenantId e limpa
 * tudo no fim — deletando os filhos por tenantId em ordem segura de FK, depois o
 * tenant. Mantém o banco de dev intacto (não toca no tenant `thepop7`).
 *
 * Requer Postgres de pé (script `test:integration`, fora do `turbo run test`).
 */
export async function withTestTenant<T>(fn: (tenantId: string) => Promise<T>): Promise<T> {
  const prisma = getPrisma();
  const slug = `itest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenant = await prisma.tenant.create({
    data: { slug, name: `IntegrationTest ${slug}`, status: "active", agentPersona: "Maya" },
  });

  try {
    return await fn(tenant.id);
  } finally {
    const t = tenant.id;
    // Ordem segura de FK: filhos → contatos → produtos → tenant.
    await prisma.orderItem.deleteMany({ where: { order: { tenantId: t } } }).catch(() => {});
    await prisma.return.deleteMany({ where: { order: { tenantId: t } } }).catch(() => {});
    await prisma.message.deleteMany({ where: { conversation: { tenantId: t } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.conversation.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.stockReservation.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.domainEvent.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.product.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: t } }).catch(() => {});
  }
}
