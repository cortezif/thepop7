import { getPrisma, withTenant, type Prisma } from "@thepop/db";

// Razão de movimentação de estoque (barcode F2). Espelho/auditoria local do canal
// — a verdade do saldo continua na Tray/CPlug. Cada in/out vira um lançamento
// identificado por código de barras.

export type MovementType = "purchase_in" | "sale_out" | "return_in" | "adjust_in" | "adjust_out";
const IN_TYPES: MovementType[] = ["purchase_in", "return_in", "adjust_in"];

export type MovementInput = {
  productId: string;
  variantSku: string;
  type: MovementType;
  quantity: number;
  barcode?: string;             // resolvido do lookup se ausente
  refType?: string;
  refId?: string;
  note?: string;
  actor?: string;
};

/** Resolve o barcode de uma variante pelo lookup (dentro da tx). */
async function barcodeFor(tx: Prisma.TransactionClient, tenantId: string, productId: string, variantSku: string): Promise<string> {
  const row = await tx.productBarcode.findFirst({ where: { tenantId, productId, variantSku }, select: { barcode: true } });
  return row?.barcode ?? "";
}

/** Registra um lançamento. Pode rodar dentro de uma tx existente (passe `tx`). */
export async function recordMovement(tenantId: string, m: MovementInput, tx?: Prisma.TransactionClient) {
  const run = async (t: Prisma.TransactionClient) => {
    const barcode = m.barcode ?? (await barcodeFor(t, tenantId, m.productId, m.variantSku));
    return t.stockMovement.create({
      data: {
        tenantId, barcode, productId: m.productId, variantSku: m.variantSku,
        type: m.type, quantity: Math.abs(m.quantity),
        refType: m.refType ?? null, refId: m.refId ?? null, note: m.note ?? null,
        actor: m.actor ?? "system",
      },
    });
  };
  return tx ? run(tx) : withTenant(tenantId, run);
}

/** Lista movimentos (por barcode OU por produto/variante), mais recentes primeiro. */
export async function listMovements(tenantId: string, filter: { barcode?: string; productId?: string; variantSku?: string; limit?: number }) {
  return getPrisma().stockMovement.findMany({
    where: {
      tenantId,
      ...(filter.barcode ? { barcode: filter.barcode } : {}),
      ...(filter.productId ? { productId: filter.productId } : {}),
      ...(filter.variantSku ? { variantSku: filter.variantSku } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: filter.limit ?? 100,
  });
}

/** Saldo líquido (entradas − saídas) a partir dos lançamentos. Função pura. */
export function netBalance(movements: Array<{ type: string; quantity: number }>): number {
  return movements.reduce((acc, m) => acc + (IN_TYPES.includes(m.type as MovementType) ? m.quantity : -m.quantity), 0);
}

/** Rastreabilidade de um código: histórico + saldo + agregados por tipo. */
export async function traceByBarcode(tenantId: string, barcode: string) {
  const movements = await listMovements(tenantId, { barcode, limit: 500 });
  const porTipo: Record<string, number> = {};
  for (const m of movements) porTipo[m.type] = (porTipo[m.type] ?? 0) + m.quantity;
  return {
    barcode,
    saldoRazao: netBalance(movements),
    porTipo,
    movimentos: movements.map((m) => ({
      id: m.id, type: m.type, quantity: m.quantity, refType: m.refType, refId: m.refId,
      note: m.note, actor: m.actor, at: m.createdAt,
    })),
  };
}
