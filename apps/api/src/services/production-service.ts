import { getPrisma, withTenant, type Prisma } from "@hubadvisor/db";
import { computeBomCost, type CostLine } from "./manufacturing-service.js";
import { recordMovement } from "./stock-movement-service.js";

// Produção (ADR-030 — Fase 2). Um lote consome insumos a partir de uma ficha
// técnica e, se pronta-entrega, soma o produto acabado ao estoque de vitrine.

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const round3 = (n: number) => Math.round(n * 1e3) / 1e3;

type BomWithItems = Prisma.BillOfMaterialsGetPayload<{ include: { items: { include: { material: true } } } }>;

export type ConsumptionLine = {
  materialId: string; name: string; baseUnit: string;
  needed: number; available: number; shortfall: number; costPerBaseUnit: number;
};
export type ProductionPlan = {
  bomId: string; bomName: string; quantity: number;
  lines: ConsumptionLine[];
  unitCost: number; totalCost: number;
  productId: string | null; variantSku: string | null;
  canAddToStock: boolean;   // existe produto+variante resolvível
  suggestedToStock: boolean; // default conforme Product.madeToOrder
  hasShortfall: boolean;
};

/** Resolve a ficha, escala o consumo para `quantity` e calcula custo + faltas. */
async function plan(
  tx: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  tenantId: string,
  bomId: string,
  quantity: number,
): Promise<ProductionPlan> {
  const bom = (await tx.billOfMaterials.findFirst({
    where: { id: bomId, tenantId, active: true },
    include: { items: { include: { material: true } } },
  })) as BomWithItems | null;
  if (!bom) throw new Error("ficha técnica não encontrada");

  const yieldQty = num(bom.yieldQty) || 1;
  const qty = Math.max(0, quantity);
  const scale = yieldQty <= 0 ? qty : qty / yieldQty;

  const lines: ConsumptionLine[] = bom.items.map((i) => {
    const needed = round3(num(i.quantity) * scale);
    const available = num(i.material.stockQty);
    return {
      materialId: i.materialId,
      name: i.material.name,
      baseUnit: i.material.baseUnit,
      needed,
      available,
      shortfall: round3(Math.max(0, needed - available)),
      costPerBaseUnit: num(i.material.costPerBaseUnit),
    };
  });

  const costLines: CostLine[] = bom.items.map((i) => ({ quantity: num(i.quantity), costPerBaseUnit: num(i.material.costPerBaseUnit) }));
  const { unitCost } = computeBomCost(costLines, yieldQty, bom.lossPct);

  // Produto + variante: vínculo da ficha, ou 1ª variante do produto.
  let productId = bom.productId ?? null;
  let variantSku = bom.variantSku ?? null;
  let suggestedToStock = false;
  let canAddToStock = false;
  if (productId) {
    const product = await tx.product.findFirst({ where: { id: productId, tenantId } });
    if (product) {
      suggestedToStock = !product.madeToOrder;
      const variants = (product.variants as Array<{ sku: string }>) ?? [];
      if (!variantSku) variantSku = variants[0]?.sku ?? null;
      canAddToStock = !!variantSku && variants.some((v) => v.sku === variantSku);
    } else {
      productId = null;
    }
  }

  return {
    bomId: bom.id, bomName: bom.name, quantity: qty,
    lines,
    unitCost: round4(unitCost), totalCost: round4(unitCost * qty),
    productId, variantSku,
    canAddToStock, suggestedToStock: canAddToStock && suggestedToStock,
    hasShortfall: lines.some((l) => l.shortfall > 0),
  };
}

export async function previewProduction(tenantId: string, bomId: string, quantity: number): Promise<ProductionPlan> {
  return plan(getPrisma(), tenantId, bomId, quantity);
}

export async function createBatch(
  tenantId: string,
  input: { bomId: string; quantity: number; addToStock?: boolean; note?: string },
) {
  if (!(input.quantity > 0)) throw new Error("quantidade deve ser maior que zero");
  return withTenant(tenantId, async (tx) => {
    const p = await plan(tx, tenantId, input.bomId, input.quantity);
    const addToStock = (input.addToStock ?? p.suggestedToStock) && p.canAddToStock;

    // 1) Consome insumos (baixa em stockQty; não bloqueia se faltar — realidade da
    //    operação —, mas o shortfall fica registrado no lote).
    const consumed: Array<{ materialId: string; name: string; baseUnit: string; quantity: number; costPerBaseUnit: number }> = [];
    for (const l of p.lines) {
      const mat = await tx.rawMaterial.findFirst({ where: { id: l.materialId, tenantId } });
      if (!mat) continue;
      const newStock = round3(num(mat.stockQty) - l.needed);
      await tx.rawMaterial.update({ where: { id: l.materialId }, data: { stockQty: newStock } });
      consumed.push({ materialId: l.materialId, name: l.name, baseUnit: l.baseUnit, quantity: l.needed, costPerBaseUnit: l.costPerBaseUnit });
    }

    // 2) Cria o lote (para ter o id antes de referenciar no movimento de estoque).
    const batch = await tx.productionBatch.create({
      data: {
        tenantId,
        bomId: p.bomId, bomName: p.bomName,
        productId: p.productId, variantSku: p.variantSku,
        quantity: p.quantity, addedToStock: addToStock,
        unitCost: p.unitCost, totalCost: p.totalCost,
        consumed: consumed as any,
        note: input.note ?? null,
      },
    });

    // 3) Pronta-entrega: soma produto acabado ao estoque de vitrine + razão.
    if (addToStock && p.productId && p.variantSku) {
      const product = await tx.product.findFirst({ where: { id: p.productId, tenantId } });
      if (product) {
        const variants = (product.variants as Array<{ sku: string; stock: number; [k: string]: unknown }>) ?? [];
        let changed = false;
        for (const v of variants) if (v.sku === p.variantSku) { v.stock = (Number(v.stock) || 0) + p.quantity; changed = true; }
        if (changed) await tx.product.update({ where: { id: p.productId }, data: { variants: variants as any } });
        await recordMovement(tenantId, {
          productId: p.productId, variantSku: p.variantSku, type: "production_in",
          quantity: Math.round(p.quantity), refType: "production", refId: batch.id, actor: "operator",
        }, tx);
      }
    }

    return {
      ok: true as const,
      batchId: batch.id,
      addedToStock: addToStock,
      unitCost: p.unitCost, totalCost: p.totalCost,
      consumed, hasShortfall: p.hasShortfall,
    };
  });
}

export async function listBatches(tenantId: string, limit = 50) {
  const rows = await getPrisma().productionBatch.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((b) => ({
    id: b.id,
    bomName: b.bomName,
    productId: b.productId,
    variantSku: b.variantSku,
    quantity: num(b.quantity),
    addedToStock: b.addedToStock,
    unitCost: num(b.unitCost),
    totalCost: num(b.totalCost),
    consumed: (b.consumed as Array<{ name: string; baseUnit: string; quantity: number }>) ?? [],
    note: b.note,
    createdAt: b.createdAt,
  }));
}
