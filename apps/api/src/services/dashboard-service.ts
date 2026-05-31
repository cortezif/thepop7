import crypto from "node:crypto";
import { getPrisma, withTenant, decryptPII } from "@hubadvisor/db";

// Wallboard de TV (ADR-040): visão ao vivo do dia para o dono acompanhar numa
// TV — vendas, pagamentos, gente em atendimento, fila de entrega e entregas.
// Tudo do dia corrente (fuso do servidor) e sempre escopado por tenantId.

const TO_SHIP = ["paid", "picking"];
const IN_TRANSIT = ["shipped", "in_transit", "out_for_delivery"];
const DELIVERED = ["delivered", "finalized"];

const num = (v: unknown) => (v == null ? 0 : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

export type TvDashboard = Awaited<ReturnType<typeof liveDashboard>>;

export async function liveDashboard(tenantId: string) {
  const prisma = getPrisma();
  const sod = new Date(); sod.setHours(0, 0, 0, 0);

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });

  return withTenant(tenantId, async (tx) => {
    const [paidToday, newOrders, byStatus, createdOrders, deliveredToday, convByStatus] = await Promise.all([
      tx.order.aggregate({ where: { tenantId, paidAt: { gte: sod } }, _sum: { totalBRL: true }, _count: { _all: true } }),
      tx.order.count({ where: { tenantId, createdAt: { gte: sod } } }),
      tx.order.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }),
      tx.order.findMany({ where: { tenantId, status: "created" }, select: { metadata: true } }),
      tx.order.count({ where: { tenantId, status: { in: DELIVERED as any }, deliveredAt: { gte: sod } } }),
      tx.conversation.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }),
    ]);

    const sCount = (s: string[]) => byStatus.filter((r) => s.includes(r.status as string)).reduce((a, r) => a + r._count._all, 0);
    const cCount = (s: string) => convByStatus.find((r) => (r.status as string) === s)?._count._all ?? 0;
    const pendingApproval = createdOrders.filter((o) => (o.metadata as any)?.pendingApproval).length;

    // Listas (com nome do cliente). Telefone decifrado só como fallback de nome.
    const [recentOrders, recentDeliveries, attending] = await Promise.all([
      tx.order.findMany({
        where: { tenantId }, orderBy: { createdAt: "desc" }, take: 8,
        select: { id: true, status: true, totalBRL: true, createdAt: true, metadata: true, contact: { select: { name: true, phone: true } } },
      }),
      tx.order.findMany({
        where: { tenantId, status: { in: DELIVERED as any }, deliveredAt: { not: null } },
        orderBy: { deliveredAt: "desc" }, take: 6,
        select: { deliveredAt: true, totalBRL: true, contact: { select: { name: true, phone: true } } },
      }),
      tx.conversation.findMany({
        where: { tenantId, status: { in: ["active", "handed_off"] } },
        orderBy: { lastMessageAt: "desc" }, take: 8,
        select: { status: true, channel: true, lastMessageAt: true, handoffReason: true, contact: { select: { name: true, phone: true } } },
      }),
    ]);

    const nameOf = (c: { name: string | null; phone: string | null } | null) =>
      c?.name ?? (c?.phone ? decryptPII(c.phone)?.replace(/.(?=.{4})/g, "•") ?? "Cliente" : "Cliente");

    return {
      store: tenant?.name ?? "Loja",
      today: {
        salesBRL: r2(num(paidToday._sum.totalBRL)),
        ordersPaid: paidToday._count._all,
        ticketBRL: paidToday._count._all ? r2(num(paidToday._sum.totalBRL) / paidToday._count._all) : 0,
        newOrders,
      },
      payments: {
        pendingApproval,
        awaitingPayment: sCount(["created"]),
      },
      attendance: {
        active: cCount("active"),
        waitingHuman: cCount("handed_off"),
      },
      fulfillment: {
        toShip: sCount(TO_SHIP),
        inTransit: sCount(IN_TRANSIT),
        deliveredToday,
      },
      recentOrders: recentOrders.map((o) => ({
        id: o.id.slice(-6), customer: nameOf(o.contact), totalBRL: r2(num(o.totalBRL)),
        status: o.status as string, pendingApproval: !!(o.metadata as any)?.pendingApproval, createdAt: o.createdAt,
      })),
      recentDeliveries: recentDeliveries.map((d) => ({ customer: nameOf(d.contact), totalBRL: r2(num(d.totalBRL)), deliveredAt: d.deliveredAt })),
      attendingNow: attending.map((c) => ({
        customer: nameOf(c.contact), channel: c.channel as string,
        waitingHuman: c.status === "handed_off", reason: c.handoffReason, lastMessageAt: c.lastMessageAt,
      })),
      updatedAt: new Date().toISOString(),
    };
  });
}

// ── Link público da TV (token em policies.tvToken) ───────────────────────────

/** Token atual da TV (ou null). */
export async function getTvToken(tenantId: string): Promise<string | null> {
  const t = await getPrisma().tenant.findUnique({ where: { id: tenantId }, select: { policies: true } });
  return ((t?.policies as any)?.tvToken as string) ?? null;
}

/** Garante um token (gera se não houver). Usado para "ativar" o link da TV. */
export async function ensureTvToken(tenantId: string): Promise<string> {
  const prisma = getPrisma();
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { policies: true } });
  const policies = (t.policies as any) ?? {};
  if (policies.tvToken) return policies.tvToken as string;
  const token = crypto.randomBytes(20).toString("hex");
  await prisma.tenant.update({ where: { id: tenantId }, data: { policies: { ...policies, tvToken: token } } });
  return token;
}

/** Gera um token novo (revoga o link anterior). */
export async function resetTvToken(tenantId: string): Promise<string> {
  const prisma = getPrisma();
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { policies: true } });
  const policies = (t.policies as any) ?? {};
  const token = crypto.randomBytes(20).toString("hex");
  await prisma.tenant.update({ where: { id: tenantId }, data: { policies: { ...policies, tvToken: token } } });
  return token;
}

/** Desativa o link público da TV. */
export async function disableTvToken(tenantId: string): Promise<void> {
  const prisma = getPrisma();
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { policies: true } });
  const policies = (t.policies as any) ?? {};
  delete policies.tvToken;
  await prisma.tenant.update({ where: { id: tenantId }, data: { policies } });
}

/** Resolve a loja pelo token público e devolve o wallboard (rota pública /tv). */
export async function liveDashboardByToken(token: string) {
  if (!token || token.length < 16) return null;
  const tenant = await getPrisma().tenant.findFirst({
    where: { policies: { path: ["tvToken"], equals: token } },
    select: { id: true },
  });
  if (!tenant) return null;
  return liveDashboard(tenant.id);
}
