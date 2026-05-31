import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { withTestTenant } from "./helpers.js";
import { createRawMaterial, createBom, insumosReorder, updateRawMaterial } from "../services/manufacturing-service.js";
import { createBatch, productionAgenda, produceForOrderItem, manufacturingReport } from "../services/production-service.js";

// Fluxos de fabricação (ADR-030) contra o DB real. Roda em `test:integration`
// (precisa Postgres). Cada teste usa um tenant descartável (withTestTenant).

const prisma = getPrisma();

/** Cria 2 insumos + 1 produto sob encomenda + a ficha técnica. */
async function setupBolo(tenantId: string) {
  const farinha = await createRawMaterial(tenantId, { name: "Farinha", baseUnit: "g", costPerBaseUnit: 0.006, stockQty: 5000, minStockQty: 1000 });
  const ovo = await createRawMaterial(tenantId, { name: "Ovo", baseUnit: "un", costPerBaseUnit: 0.7, stockQty: 60, minStockQty: 12 });
  const product = await prisma.product.create({
    data: {
      tenantId, externalId: "BOLO", name: "Bolo", priceBRL: 120, madeToOrder: true, leadTimeDays: 2,
      variants: [{ sku: "BOLO-2KG", stock: 0 }] as any, media: {} as any, styles: [], occasions: [],
      enrichmentStatus: "approved", active: true,
    },
  });
  const bom = await createBom(tenantId, {
    name: "Bolo", productId: product.id, variantSku: "BOLO-2KG", yieldQty: 1, lossPct: 0,
    items: [{ materialId: farinha.id, quantity: 800 }, { materialId: ovo.id, quantity: 4 }],
  });
  return { farinha, ovo, product, bom };
}

test("createBom propaga custo p/ Product.costBRL e recalcula ao mudar preço do insumo", async () => {
  await withTestTenant(async (tenantId) => {
    const { farinha, product } = await setupBolo(tenantId);
    // 800×0,006 + 4×0,70 = 4,80 + 2,80 = 7,60
    const p1 = await prisma.product.findUnique({ where: { id: product.id } });
    assert.equal(Number(p1!.costBRL), 7.6);

    // muda o preço da farinha → recalcula: 800×0,01 + 2,80 = 10,80
    await updateRawMaterial(tenantId, farinha.id, { costPerBaseUnit: 0.01 });
    const p2 = await prisma.product.findUnique({ where: { id: product.id } });
    assert.equal(Number(p2!.costBRL), 10.8);
  });
});

test("createBatch baixa os insumos (sob encomenda, não vai pra vitrine)", async () => {
  await withTestTenant(async (tenantId) => {
    const { farinha, ovo, bom } = await setupBolo(tenantId);
    const r = await createBatch(tenantId, { bomId: bom.id, quantity: 2, addToStock: false });
    assert.equal(r.ok, true);
    assert.equal(r.totalCost, 15.2); // 7,60 × 2

    const f = await prisma.rawMaterial.findUnique({ where: { id: farinha.id } });
    assert.equal(Number(f!.stockQty), 5000 - 1600, "farinha 5000 − 2×800");
    const o = await prisma.rawMaterial.findUnique({ where: { id: ovo.id } });
    assert.equal(Number(o!.stockQty), 60 - 8, "ovo 60 − 2×4");
  });
});

test("agenda usa desiredDate; produzir-da-agenda baixa insumos e remove o item", async () => {
  await withTestTenant(async (tenantId) => {
    const { farinha, product } = await setupBolo(tenantId);
    const contact = await prisma.contact.create({ data: { tenantId, name: "Ana" } });
    const order = await prisma.order.create({
      data: {
        tenantId, contactId: contact.id, status: "paid", subtotalBRL: 120, shippingBRL: 0, totalBRL: 120,
        metadata: { desiredDate: "2026-06-20" } as any,
        items: { create: [{ productId: product.id, variantSku: "BOLO-2KG", quantity: 1, unitPriceBRL: 120 }] },
      },
    });

    const agenda = await productionAgenda(tenantId);
    assert.equal(agenda.length, 1);
    assert.equal(agenda[0]!.dueDate, "2026-06-20");
    assert.equal(agenda[0]!.dateSource, "desejada");

    await produceForOrderItem(tenantId, order.id, "BOLO-2KG");

    const f = await prisma.rawMaterial.findUnique({ where: { id: farinha.id } });
    assert.equal(Number(f!.stockQty), 5000 - 800, "1 bolo consome 800g");
    const agenda2 = await productionAgenda(tenantId);
    assert.equal(agenda2.length, 0, "item produzido sai da agenda");
  });
});

test("insumosReorder sugere reposição abaixo do mínimo (até 2× o mínimo)", async () => {
  await withTestTenant(async (tenantId) => {
    const { ovo } = await setupBolo(tenantId);
    await updateRawMaterial(tenantId, ovo.id, { stockQty: 5 }); // min 12
    const reorder = await insumosReorder(tenantId);
    const ovoR = reorder.find((r) => r.name === "Ovo");
    assert.ok(ovoR, "Ovo aparece na reposição");
    assert.equal(ovoR!.suggestedQty, 19); // 2×12 − 5
    // farinha (5000 > min 1000) não deve aparecer
    assert.equal(reorder.find((r) => r.name === "Farinha"), undefined);
  });
});

test("manufacturingReport: margem do produto + produção + consumo de insumos", async () => {
  await withTestTenant(async (tenantId) => {
    const { bom } = await setupBolo(tenantId);
    await createBatch(tenantId, { bomId: bom.id, quantity: 2, addToStock: false });

    const rep = await manufacturingReport(tenantId);
    const m = rep.margins.find((x) => x.productName === "Bolo");
    assert.ok(m, "margem do bolo presente");
    assert.equal(m!.priceBRL, 120);
    assert.equal(m!.unitCost, 7.6);
    assert.equal(m!.marginPct, 93.7); // (120−7,6)/120 = 93,67 → 93,7

    assert.equal(rep.production.batches, 1);
    assert.equal(rep.production.units, 2);
    const farinhaUse = rep.insumoConsumption.find((c) => c.name === "Farinha");
    assert.equal(farinhaUse!.quantity, 1600); // 2×800
    assert.equal(farinhaUse!.costBRL, 9.6);   // 1600×0,006
  });
});
