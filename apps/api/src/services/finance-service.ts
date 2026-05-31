import { getPrisma, withTenant } from "@hubadvisor/db";

// Financeiro / fluxo de caixa (ADR-032). Receitas de VENDAS vêm dos pedidos pagos
// (derivadas, read-only); despesas e outras receitas são lançamentos manuais.
// Saldo do mês = vendas + receitas manuais − despesas.

const num = (d: { toString(): string } | number | null | undefined) => (d == null ? 0 : Number(d));
const r2 = (n: number) => Math.round(n * 100) / 100;

export const ENTRY_TYPES = ["receita", "despesa"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export type EntryLike = { type: string; category: string; amountBRL: number };

/** Intervalo [start, end) de um mês "YYYY-MM". Pura. null se formato inválido. */
export function monthRange(month: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { start: new Date(y, mo - 1, 1), end: new Date(y, mo, 1) };
}

/** Mês corrente "YYYY-MM" a partir de uma data. Pura. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Consolida lançamentos manuais por tipo/categoria. Pura (testável). */
export function summarizeEntries(entries: EntryLike[]) {
  let receitasManuaisBRL = 0, despesasBRL = 0;
  const cat = new Map<string, { type: EntryType; category: string; totalBRL: number }>();
  for (const e of entries) {
    const isDesp = e.type === "despesa";
    if (isDesp) despesasBRL += e.amountBRL; else receitasManuaisBRL += e.amountBRL;
    const key = `${e.type}:${e.category}`;
    const cur = cat.get(key) ?? { type: (isDesp ? "despesa" : "receita") as EntryType, category: e.category, totalBRL: 0 };
    cur.totalBRL = r2(cur.totalBRL + e.amountBRL);
    cat.set(key, cur);
  }
  return {
    receitasManuaisBRL: r2(receitasManuaisBRL),
    despesasBRL: r2(despesasBRL),
    byCategory: [...cat.values()].sort((a, b) => b.totalBRL - a.totalBRL),
  };
}

export async function cashflow(tenantId: string, month: string) {
  const range = monthRange(month) ?? monthRange(monthKey(new Date()))!;
  const prisma = getPrisma();

  // Vendas (caixa) = pedidos pagos no período. paidAt quando houver; senão createdAt.
  const paidOrders = await prisma.order.findMany({
    where: {
      tenantId,
      status: { in: ["paid", "delivered", "shipped"] },
      OR: [
        { paidAt: { gte: range.start, lt: range.end } },
        { paidAt: null, createdAt: { gte: range.start, lt: range.end } },
      ],
    },
    select: { totalBRL: true },
  });
  const vendasBRL = r2(paidOrders.reduce((s, o) => s + num(o.totalBRL), 0));

  const entries = await prisma.financialEntry.findMany({
    where: { tenantId, date: { gte: range.start, lt: range.end } },
    select: { type: true, category: true, amountBRL: true },
  });
  const sum = summarizeEntries(entries.map((e) => ({ type: e.type, category: e.category, amountBRL: num(e.amountBRL) })));

  const receitasBRL = r2(vendasBRL + sum.receitasManuaisBRL);
  return {
    month: monthKey(range.start),
    vendasBRL,
    ordersCount: paidOrders.length,
    receitasManuaisBRL: sum.receitasManuaisBRL,
    receitasBRL,
    despesasBRL: sum.despesasBRL,
    saldoBRL: r2(receitasBRL - sum.despesasBRL),
    byCategory: sum.byCategory,
  };
}

export async function listEntries(tenantId: string, month: string) {
  const range = monthRange(month) ?? monthRange(monthKey(new Date()))!;
  const rows = await getPrisma().financialEntry.findMany({
    where: { tenantId, date: { gte: range.start, lt: range.end } },
    orderBy: { date: "desc" },
    take: 500,
  });
  return rows.map((e) => ({ ...e, amountBRL: num(e.amountBRL) }));
}

export async function createEntry(
  tenantId: string,
  input: { type: EntryType; category: string; description?: string; amountBRL: number; date?: string },
) {
  const date = input.date ? new Date(input.date) : new Date();
  return withTenant(tenantId, (tx) =>
    tx.financialEntry.create({
      data: {
        tenantId,
        type: input.type === "despesa" ? "despesa" : "receita",
        category: input.category.trim() || "outro",
        description: input.description?.trim() || null,
        amountBRL: Math.abs(r2(input.amountBRL)),
        date: isNaN(date.getTime()) ? new Date() : date,
      },
    }),
  );
}

export async function deleteEntry(tenantId: string, id: string) {
  return withTenant(tenantId, async (tx) => {
    const e = await tx.financialEntry.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!e) throw new Error("lançamento não encontrado");
    await tx.financialEntry.delete({ where: { id } });
    return { ok: true };
  });
}
