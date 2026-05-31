import { getPrisma } from "@hubadvisor/db";

// Relatório de marketing/fidelidade (ADR-031). Consolida o razão de cashback
// (acumulado/resgatado/expirado + passivo em aberto) e o desempenho das campanhas.

const num = (d: { toString(): string } | number | null | undefined) => (d == null ? 0 : Number(d));
const r2 = (n: number) => Math.round(n * 100) / 100;

export type MarketingReport = {
  cashback: {
    accruedBRL: number;     // total já creditado
    redeemedBRL: number;    // total usado em pedidos
    expiredBRL: number;     // total perdido por vencimento
    activeBalanceBRL: number;  // passivo em aberto (saldo vivo dos clientes)
    expiring30BRL: number;     // do passivo, quanto vence em 30 dias
    redemptionRate: number;    // resgatado / acumulado (0..1)
    contactsWithBalance: number;
  };
  campaigns: {
    total: number;
    sent: number;
    recipients: number;
    sentWhatsapp: number;
    sentEmail: number;
    sentSms: number;
  };
};

export async function marketingReport(tenantId: string): Promise<MarketingReport> {
  const prisma = getPrisma();
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86_400_000);

  const [accrual, redeem, expire, active, expiring, campAgg, campCount, sentCount] = await Promise.all([
    prisma.cashbackEntry.aggregate({ where: { tenantId, kind: "accrual" }, _sum: { amountBRL: true } }),
    prisma.cashbackEntry.aggregate({ where: { tenantId, kind: "redeem" }, _sum: { amountBRL: true } }),
    prisma.cashbackEntry.aggregate({ where: { tenantId, kind: "expire" }, _sum: { amountBRL: true } }),
    prisma.cashbackEntry.groupBy({
      by: ["contactId"],
      where: { tenantId, kind: "accrual", remainingBRL: { gt: 0 }, expiresAt: { gt: now } },
      _sum: { remainingBRL: true },
    }),
    prisma.cashbackEntry.aggregate({
      where: { tenantId, kind: "accrual", remainingBRL: { gt: 0 }, expiresAt: { gt: now, lte: in30 } },
      _sum: { remainingBRL: true },
    }),
    prisma.marketingCampaign.aggregate({
      where: { tenantId, status: "enviada" },
      _sum: { recipients: true, sentWhatsapp: true, sentEmail: true, sentSms: true },
    }),
    prisma.marketingCampaign.count({ where: { tenantId } }),
    prisma.marketingCampaign.count({ where: { tenantId, status: "enviada" } }),
  ]);

  const accruedBRL = r2(num(accrual._sum.amountBRL));
  const redeemedBRL = r2(Math.abs(num(redeem._sum.amountBRL)));   // lançamentos são negativos
  const expiredBRL = r2(Math.abs(num(expire._sum.amountBRL)));
  const activeBalanceBRL = r2(active.reduce((s, a) => s + num(a._sum.remainingBRL), 0));

  return {
    cashback: {
      accruedBRL,
      redeemedBRL,
      expiredBRL,
      activeBalanceBRL,
      expiring30BRL: r2(num(expiring._sum.remainingBRL)),
      redemptionRate: accruedBRL > 0 ? r2(redeemedBRL / accruedBRL) : 0,
      contactsWithBalance: active.length,
    },
    campaigns: {
      total: campCount,
      sent: sentCount,
      recipients: campAgg._sum.recipients ?? 0,
      sentWhatsapp: campAgg._sum.sentWhatsapp ?? 0,
      sentEmail: campAgg._sum.sentEmail ?? 0,
      sentSms: campAgg._sum.sentSms ?? 0,
    },
  };
}
