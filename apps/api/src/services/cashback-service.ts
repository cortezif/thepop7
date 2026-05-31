import { getPrisma, withTenant, type Prisma } from "@hubadvisor/db";

// Cashback / fidelidade (ADR-031). Razão append-only por cliente:
//  - accrual: crédito ganho na compra (remainingBRL = saldo ainda disponível).
//  - redeem: crédito usado num pedido (amountBRL negativo).
//  - expire: crédito vencido sem uso (amountBRL negativo).
// Saldo = Σ remainingBRL dos accruals não-expirados. Resgate consome FIFO pelos
// que vencem primeiro (o cliente não perde crédito à toa).

export type CashbackConfig = { enabled: boolean; pct: number; expiryDays: number; maxRedeemPct: number };

export function cashbackConfigOf(t: { cashbackEnabled: boolean; cashbackPct: number; cashbackExpiryDays: number; cashbackMaxRedeemPct: number }): CashbackConfig {
  return { enabled: t.cashbackEnabled, pct: t.cashbackPct, expiryDays: t.cashbackExpiryDays, maxRedeemPct: t.cashbackMaxRedeemPct };
}

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Funções puras (testáveis) ────────────────────────────────────────────────
export type Accrual = { id: string; remainingBRL: number; expiresAt: Date | string | null };

const valid = (a: Accrual, now: Date) => !!a.expiresAt && new Date(a.expiresAt) > now && a.remainingBRL > 0;

/** Saldo disponível = Σ remaining dos accruals não-expirados. */
export function availableBalance(accruals: Accrual[], now: Date): number {
  return r2(accruals.reduce((s, a) => s + (valid(a, now) ? a.remainingBRL : 0), 0));
}

/** Plano de resgate FIFO (consome primeiro o que vence antes). Pura. */
export function planRedemption(accruals: Accrual[], amount: number, now: Date): { consume: Array<{ id: string; take: number }>; total: number } {
  const ordered = accruals
    .filter((a) => valid(a, now))
    .sort((a, b) => new Date(a.expiresAt!).getTime() - new Date(b.expiresAt!).getTime());
  let left = r2(Math.max(0, amount));
  const consume: Array<{ id: string; take: number }> = [];
  for (const a of ordered) {
    if (left <= 0) break;
    const take = r2(Math.min(a.remainingBRL, left));
    if (take > 0) { consume.push({ id: a.id, take }); left = r2(left - take); }
  }
  return { consume, total: r2(consume.reduce((s, c) => s + c.take, 0)) };
}

/** Quanto pode ser resgatado: min(saldo, teto% do pedido). Pura. */
export function redeemableFor(balance: number, orderSubtotalBRL: number, maxRedeemPct: number): number {
  return r2(Math.min(Math.max(0, balance), r2(orderSubtotalBRL * maxRedeemPct / 100)));
}

// ── Operações no banco ───────────────────────────────────────────────────────
async function cfgOf(tenantId: string): Promise<CashbackConfig> {
  const t = await getPrisma().tenant.findUnique({ where: { id: tenantId } });
  return cashbackConfigOf(t!);
}

async function activeAccruals(tx: Prisma.TransactionClient | ReturnType<typeof getPrisma>, tenantId: string, contactId: string) {
  return tx.cashbackEntry.findMany({
    where: { tenantId, contactId, kind: "accrual", remainingBRL: { gt: 0 }, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: "asc" },
  });
}

export async function cashbackBalance(tenantId: string, contactId: string): Promise<number> {
  const rows = await activeAccruals(getPrisma(), tenantId, contactId);
  return availableBalance(rows.map((a) => ({ id: a.id, remainingBRL: num(a.remainingBRL), expiresAt: a.expiresAt })), new Date());
}

/** Acumula cashback (chamado ao pagar o pedido). Idempotente por orderId. */
export async function accrueCashback(tenantId: string, contactId: string, baseBRL: number, orderId?: string, cfg?: CashbackConfig) {
  const c = cfg ?? (await cfgOf(tenantId));
  if (!c.enabled || c.pct <= 0 || baseBRL <= 0) return { accruedBRL: 0 };
  const amount = r2(baseBRL * c.pct / 100);
  if (amount <= 0) return { accruedBRL: 0 };
  return withTenant(tenantId, async (tx) => {
    if (orderId) {
      const dup = await tx.cashbackEntry.findFirst({ where: { tenantId, kind: "accrual", orderId } });
      if (dup) return { accruedBRL: 0, skipped: true as const };
    }
    const expiresAt = new Date(Date.now() + c.expiryDays * 86_400_000);
    await tx.cashbackEntry.create({
      data: { tenantId, contactId, kind: "accrual", amountBRL: amount, remainingBRL: amount, orderId: orderId ?? null, expiresAt, note: `Cashback ${c.pct}% da compra` },
    });
    return { accruedBRL: amount, expiresAt: expiresAt.toISOString() };
  });
}

/**
 * Resgata cashback para um pedido (FIFO, até o teto). Roda dentro de uma tx
 * existente (passe `tx`) para ser atômico com a criação do pedido. Devolve o
 * valor resgatado (a abater do total).
 */
export async function redeemForOrder(
  tenantId: string, contactId: string, orderSubtotalBRL: number, orderId: string, cfg?: CashbackConfig, tx?: Prisma.TransactionClient,
): Promise<number> {
  const c = cfg ?? (await cfgOf(tenantId));
  if (!c.enabled || c.maxRedeemPct <= 0) return 0;
  const run = async (t: Prisma.TransactionClient) => {
    const rows = await activeAccruals(t, tenantId, contactId);
    const accruals: Accrual[] = rows.map((a) => ({ id: a.id, remainingBRL: num(a.remainingBRL), expiresAt: a.expiresAt }));
    const redeem = redeemableFor(availableBalance(accruals, new Date()), orderSubtotalBRL, c.maxRedeemPct);
    if (redeem <= 0) return 0;
    const plan = planRedemption(accruals, redeem, new Date());
    for (const cns of plan.consume) {
      const a = accruals.find((x) => x.id === cns.id)!;
      await t.cashbackEntry.update({ where: { id: cns.id }, data: { remainingBRL: r2(a.remainingBRL - cns.take) } });
    }
    await t.cashbackEntry.create({
      data: { tenantId, contactId, kind: "redeem", amountBRL: -plan.total, remainingBRL: 0, orderId, note: "Resgate no pedido" },
    });
    return plan.total;
  };
  return tx ? run(tx) : withTenant(tenantId, run);
}

/** Expira accruals vencidos sem uso (cron/nudge). Cria lançamentos de expiração. */
export async function expireStale(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const stale = await tx.cashbackEntry.findMany({ where: { tenantId, kind: "accrual", remainingBRL: { gt: 0 }, expiresAt: { lte: new Date() } } });
    let expiredBRL = 0;
    for (const a of stale) {
      const rem = num(a.remainingBRL);
      await tx.cashbackEntry.update({ where: { id: a.id }, data: { remainingBRL: 0 } });
      await tx.cashbackEntry.create({ data: { tenantId, contactId: a.contactId, kind: "expire", amountBRL: -rem, remainingBRL: 0, note: "Crédito expirado" } });
      expiredBRL += rem;
    }
    return { expiredBRL: r2(expiredBRL), count: stale.length };
  });
}
