import { getPrisma, withTenant, type Prisma } from "@hubadvisor/db";

// Fabricação (ADR-030). Insumos/embalagens (RawMaterial), ficha técnica
// (BillOfMaterials + BomItem) e custeio: a partir da receita o custo unitário
// do produto é calculado e propagado para Product.costBRL (alimenta a margem).

// ── Custo da ficha técnica (função pura, testável) ──────────────────────────
export type CostLine = { quantity: number; costPerBaseUnit: number };

/**
 * Custo total e unitário de uma receita.
 * total = Σ (quantidade × custo/unidade-base) × (1 + perda%/100)
 * unit  = total ÷ rendimento
 */
export function computeBomCost(
  lines: CostLine[],
  yieldQty: number,
  lossPct: number,
): { totalCost: number; unitCost: number } {
  const raw = lines.reduce((acc, l) => acc + (Number(l.quantity) || 0) * (Number(l.costPerBaseUnit) || 0), 0);
  const withLoss = raw * (1 + (Number(lossPct) || 0) / 100);
  const y = Number(yieldQty) || 1;
  const unitCost = withLoss / (y <= 0 ? 1 : y);
  return { totalCost: round4(withLoss), unitCost: round4(unitCost) };
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

// ── Insumos / embalagens ────────────────────────────────────────────────────
export type RawMaterialInput = {
  name: string;
  category?: string;          // ingrediente | embalagem
  baseUnit?: string;          // g | kg | ml | L | un
  sku?: string | null;
  costPerBaseUnit?: number;
  purchaseUnit?: string | null;
  purchaseQtyInBase?: number | null;
  stockQty?: number;
  minStockQty?: number | null;
  supplierId?: string | null;
};

export async function listRawMaterials(tenantId: string, opts?: { category?: string; includeInactive?: boolean }) {
  const rows = await getPrisma().rawMaterial.findMany({
    where: {
      tenantId,
      ...(opts?.category ? { category: opts.category } : {}),
      ...(opts?.includeInactive ? {} : { active: true }),
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return rows.map(serializeMaterial);
}

export async function createRawMaterial(tenantId: string, input: RawMaterialInput) {
  const row = await withTenant(tenantId, (tx) =>
    tx.rawMaterial.create({
      data: {
        tenantId,
        name: input.name.trim(),
        category: input.category ?? "ingrediente",
        baseUnit: input.baseUnit ?? "g",
        sku: input.sku ?? null,
        costPerBaseUnit: input.costPerBaseUnit ?? 0,
        purchaseUnit: input.purchaseUnit ?? null,
        purchaseQtyInBase: input.purchaseQtyInBase ?? null,
        stockQty: input.stockQty ?? 0,
        minStockQty: input.minStockQty ?? null,
        supplierId: input.supplierId ?? null,
      },
    }),
  );
  return serializeMaterial(row);
}

export async function updateRawMaterial(tenantId: string, id: string, input: Partial<RawMaterialInput>) {
  const data: Record<string, unknown> = {};
  if (input.name != null) data.name = input.name.trim();
  if (input.category != null) data.category = input.category;
  if (input.baseUnit != null) data.baseUnit = input.baseUnit;
  if ("sku" in input) data.sku = input.sku ?? null;
  if (input.costPerBaseUnit != null) data.costPerBaseUnit = input.costPerBaseUnit;
  if ("purchaseUnit" in input) data.purchaseUnit = input.purchaseUnit ?? null;
  if ("purchaseQtyInBase" in input) data.purchaseQtyInBase = input.purchaseQtyInBase ?? null;
  if (input.stockQty != null) data.stockQty = input.stockQty;
  if ("minStockQty" in input) data.minStockQty = input.minStockQty ?? null;
  if ("supplierId" in input) data.supplierId = input.supplierId ?? null;

  return withTenant(tenantId, async (tx) => {
    const existing = await tx.rawMaterial.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error("insumo não encontrado");
    const row = await tx.rawMaterial.update({ where: { id }, data });
    // Custo mudou → repropaga para todo produto que usa esse insumo.
    if (input.costPerBaseUnit != null) await recomputeBomsUsingMaterial(tx, tenantId, id);
    return serializeMaterial(row);
  });
}

/**
 * Reposição de insumos: lista os que estão no/abaixo do mínimo, com a quantidade
 * sugerida de compra (alvo: 2× o mínimo) — na unidade-base e, se a compra for em
 * embalagem (purchaseQtyInBase), o nº de unidades de compra. Alimenta a tela de
 * reposição e a criação de pesquisa de preço (Mercadológica).
 */
export type ReorderSuggestion = {
  id: string; name: string; category: string; baseUnit: string;
  stockQty: number; minStockQty: number; suggestedQty: number;
  purchaseUnit: string | null; purchaseUnits: number | null; supplierId: string | null;
};

export async function insumosReorder(tenantId: string): Promise<ReorderSuggestion[]> {
  const rows = await getPrisma().rawMaterial.findMany({
    where: { tenantId, active: true, minStockQty: { not: null } },
    orderBy: { name: "asc" },
  });
  const out: ReorderSuggestion[] = [];
  for (const r of rows) {
    const min = num(r.minStockQty);
    const stock = num(r.stockQty);
    if (stock > min) continue; // só os no/abaixo do mínimo
    const suggestedQty = Math.max(0, Math.round((2 * min - stock) * 1000) / 1000); // sobe até 2× o mínimo
    const pqb = r.purchaseQtyInBase == null ? null : num(r.purchaseQtyInBase);
    out.push({
      id: r.id, name: r.name, category: r.category, baseUnit: r.baseUnit,
      stockQty: stock, minStockQty: min, suggestedQty,
      purchaseUnit: r.purchaseUnit, purchaseUnits: pqb && pqb > 0 ? Math.ceil(suggestedQty / pqb) : null,
      supplierId: r.supplierId,
    });
  }
  return out;
}

/** Desativa (soft delete — preserva fichas que referenciam o insumo). */
export async function deactivateRawMaterial(tenantId: string, id: string) {
  return withTenant(tenantId, async (tx) => {
    const existing = await tx.rawMaterial.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error("insumo não encontrado");
    await tx.rawMaterial.update({ where: { id }, data: { active: false } });
    return { ok: true as const };
  });
}

function serializeMaterial(r: Prisma.RawMaterialGetPayload<{}>) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    baseUnit: r.baseUnit,
    sku: r.sku,
    costPerBaseUnit: num(r.costPerBaseUnit),
    purchaseUnit: r.purchaseUnit,
    purchaseQtyInBase: r.purchaseQtyInBase == null ? null : num(r.purchaseQtyInBase),
    stockQty: num(r.stockQty),
    minStockQty: r.minStockQty == null ? null : num(r.minStockQty),
    lowStock: r.minStockQty != null && num(r.stockQty) <= num(r.minStockQty),
    supplierId: r.supplierId,
    active: r.active,
  };
}

// ── Ficha técnica (receita) ─────────────────────────────────────────────────
export type BomItemInput = { materialId: string; quantity: number; note?: string | null };
export type BomInput = {
  name: string;
  productId?: string | null;
  variantSku?: string | null;
  yieldQty?: number;
  yieldUnit?: string | null;
  lossPct?: number;
  notes?: string | null;
  items: BomItemInput[];
};

type BomWithItems = Prisma.BillOfMaterialsGetPayload<{ include: { items: { include: { material: true } } } }>;

export async function listBoms(tenantId: string) {
  const rows = await getPrisma().billOfMaterials.findMany({
    where: { tenantId, active: true },
    include: { items: { include: { material: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map(serializeBom);
}

export async function createBom(tenantId: string, input: BomInput) {
  return withTenant(tenantId, async (tx) => {
    await assertMaterialsExist(tx, tenantId, input.items.map((i) => i.materialId));
    const bom = await tx.billOfMaterials.create({
      data: {
        tenantId,
        name: input.name.trim(),
        productId: input.productId ?? null,
        variantSku: input.variantSku ?? null,
        yieldQty: input.yieldQty ?? 1,
        yieldUnit: input.yieldUnit ?? null,
        lossPct: input.lossPct ?? 0,
        notes: input.notes ?? null,
        items: { create: input.items.map((i) => ({ materialId: i.materialId, quantity: i.quantity, note: i.note ?? null })) },
      },
      include: { items: { include: { material: true } } },
    });
    await applyBomCostToProduct(tx, tenantId, bom);
    return serializeBom(bom);
  });
}

export async function updateBom(tenantId: string, id: string, input: BomInput) {
  return withTenant(tenantId, async (tx) => {
    const existing = await tx.billOfMaterials.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error("ficha técnica não encontrada");
    await assertMaterialsExist(tx, tenantId, input.items.map((i) => i.materialId));
    // Substitui as linhas (replace) — simples e previsível no MVP.
    await tx.bomItem.deleteMany({ where: { bomId: id } });
    const bom = await tx.billOfMaterials.update({
      where: { id },
      data: {
        name: input.name.trim(),
        productId: input.productId ?? null,
        variantSku: input.variantSku ?? null,
        yieldQty: input.yieldQty ?? 1,
        yieldUnit: input.yieldUnit ?? null,
        lossPct: input.lossPct ?? 0,
        notes: input.notes ?? null,
        items: { create: input.items.map((i) => ({ materialId: i.materialId, quantity: i.quantity, note: i.note ?? null })) },
      },
      include: { items: { include: { material: true } } },
    });
    await applyBomCostToProduct(tx, tenantId, bom);
    return serializeBom(bom);
  });
}

export async function deleteBom(tenantId: string, id: string) {
  return withTenant(tenantId, async (tx) => {
    const existing = await tx.billOfMaterials.findFirst({ where: { id, tenantId } });
    if (!existing) throw new Error("ficha técnica não encontrada");
    await tx.billOfMaterials.update({ where: { id }, data: { active: false } });
    return { ok: true as const };
  });
}

function serializeBom(b: BomWithItems) {
  const lines: CostLine[] = b.items.map((i) => ({ quantity: num(i.quantity), costPerBaseUnit: num(i.material.costPerBaseUnit) }));
  const cost = computeBomCost(lines, num(b.yieldQty), b.lossPct);
  return {
    id: b.id,
    name: b.name,
    productId: b.productId,
    variantSku: b.variantSku,
    yieldQty: num(b.yieldQty),
    yieldUnit: b.yieldUnit,
    lossPct: b.lossPct,
    notes: b.notes,
    items: b.items.map((i) => ({
      materialId: i.materialId,
      materialName: i.material.name,
      baseUnit: i.material.baseUnit,
      category: i.material.category,
      costPerBaseUnit: num(i.material.costPerBaseUnit),
      quantity: num(i.quantity),
      lineCost: round4(num(i.quantity) * num(i.material.costPerBaseUnit)),
      note: i.note,
    })),
    totalCost: cost.totalCost,
    unitCost: cost.unitCost,
  };
}

// ── Propagação de custo → Product.costBRL ───────────────────────────────────
async function applyBomCostToProduct(tx: Prisma.TransactionClient, tenantId: string, bom: BomWithItems) {
  if (!bom.productId) return;
  const lines: CostLine[] = bom.items.map((i) => ({ quantity: num(i.quantity), costPerBaseUnit: num(i.material.costPerBaseUnit) }));
  const { unitCost } = computeBomCost(lines, num(bom.yieldQty), bom.lossPct);
  const product = await tx.product.findFirst({ where: { id: bom.productId, tenantId } });
  if (!product) return;
  await tx.product.update({ where: { id: bom.productId }, data: { costBRL: round4(unitCost) } });
}

/** Recalcula o custo das fichas que usam um insumo e repropaga aos produtos. */
async function recomputeBomsUsingMaterial(tx: Prisma.TransactionClient, tenantId: string, materialId: string) {
  const boms = await tx.billOfMaterials.findMany({
    where: { tenantId, active: true, items: { some: { materialId } } },
    include: { items: { include: { material: true } } },
  });
  for (const bom of boms) await applyBomCostToProduct(tx, tenantId, bom);
}

async function assertMaterialsExist(tx: Prisma.TransactionClient, tenantId: string, materialIds: string[]) {
  const unique = [...new Set(materialIds)];
  if (unique.length === 0) return;
  const found = await tx.rawMaterial.findMany({ where: { id: { in: unique }, tenantId }, select: { id: true } });
  if (found.length !== unique.length) throw new Error("insumo inválido na ficha técnica");
}
