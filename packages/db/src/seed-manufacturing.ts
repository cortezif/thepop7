/* Seed de DEMONSTRAÇÃO de fabricação (ADR-030). Idempotente. Roda após o seed
   principal: liga o modo fabricação na loja-piloto (thepop7), cadastra insumos,
   uma receita de bolo (com custo automático no produto), e a tarifa de entrega
   própria. Uso: npm --workspace @hubadvisor/db run seed:manufacturing */
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env") });

import { getPrisma } from "./index.js";

const prisma = getPrisma();

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: "thepop7" } });
  if (!tenant) throw new Error("Tenant thepop7 não existe — rode o seed principal antes.");
  const tenantId = tenant.id;

  // 1) Liga o modo fabricação.
  await prisma.tenant.update({ where: { id: tenantId }, data: { productionEnabled: true } });

  // 2) Insumos (ingredientes em g/un + embalagem). Upsert por nome (idempotente).
  const materialDefs = [
    { name: "Farinha de trigo", category: "ingrediente", baseUnit: "g", costPerBaseUnit: 0.006, stockQty: 5000, minStockQty: 1000, purchaseUnit: "saco 5kg", purchaseQtyInBase: 5000 },
    { name: "Açúcar",           category: "ingrediente", baseUnit: "g", costPerBaseUnit: 0.005, stockQty: 4000, minStockQty: 800 },
    { name: "Chocolate em pó",  category: "ingrediente", baseUnit: "g", costPerBaseUnit: 0.04,  stockQty: 1500, minStockQty: 300 },
    { name: "Manteiga",         category: "ingrediente", baseUnit: "g", costPerBaseUnit: 0.03,  stockQty: 2000, minStockQty: 400 },
    { name: "Ovo",              category: "ingrediente", baseUnit: "un", costPerBaseUnit: 0.70,  stockQty: 60,   minStockQty: 12 },
    { name: "Leite",            category: "ingrediente", baseUnit: "ml", costPerBaseUnit: 0.005, stockQty: 6000, minStockQty: 1000 },
    { name: "Caixa de bolo",    category: "embalagem",   baseUnit: "un", costPerBaseUnit: 2.50,  stockQty: 40,   minStockQty: 10 },
    { name: "Sacola",           category: "embalagem",   baseUnit: "un", costPerBaseUnit: 0.40,  stockQty: 100,  minStockQty: 20 },
  ];
  const matByName: Record<string, string> = {};
  for (const m of materialDefs) {
    const existing = await prisma.rawMaterial.findFirst({ where: { tenantId, name: m.name } });
    const row = existing
      ? await prisma.rawMaterial.update({ where: { id: existing.id }, data: { ...m, active: true } })
      : await prisma.rawMaterial.create({ data: { tenantId, ...m } });
    matByName[m.name] = row.id;
  }

  // 3) Produto fabricado (sob encomenda, prazo 2 dias).
  const externalId = "BOLO-CHOC";
  const variantSku = "BOLO-CHOC-2KG";
  const product = await prisma.product.upsert({
    where: { tenantId_externalId: { tenantId, externalId } },
    update: { madeToOrder: true, leadTimeDays: 2, deliveryVolume: 1, active: true },
    create: {
      tenantId, externalId, source: "manual",
      name: "Bolo de Chocolate 2kg",
      description: "Massa amanteigada de chocolate, recheio cremoso. Sob encomenda.",
      priceBRL: 120, madeToOrder: true, leadTimeDays: 2, deliveryVolume: 1,
      styles: ["aniversario", "gourmet"], occasions: ["aniversario"],
      variants: [{ sku: variantSku, color: null, size: "2kg", stock: 0 }],
      media: { mainPhoto: null, photos: [], videos: [] },
    },
  });

  // 4) Ficha técnica (rende 1 bolo, 8% de perda). Substitui itens (replace).
  const bomItems = [
    { name: "Farinha de trigo", quantity: 800 },
    { name: "Açúcar",           quantity: 600 },
    { name: "Chocolate em pó",  quantity: 200 },
    { name: "Manteiga",         quantity: 250 },
    { name: "Ovo",              quantity: 4 },
    { name: "Leite",            quantity: 300 },
    { name: "Caixa de bolo",    quantity: 1 },
    { name: "Sacola",           quantity: 1 },
  ];
  const existingBom = await prisma.billOfMaterials.findFirst({ where: { tenantId, productId: product.id } });
  if (existingBom) await prisma.bomItem.deleteMany({ where: { bomId: existingBom.id } });
  const bomData = {
    tenantId, name: "Bolo de Chocolate 2kg", productId: product.id, variantSku,
    yieldQty: 1, yieldUnit: "un", lossPct: 8,
    items: { create: bomItems.map((i) => ({ materialId: matByName[i.name]!, quantity: i.quantity })) },
  };
  const bom = existingBom
    ? await prisma.billOfMaterials.update({ where: { id: existingBom.id }, data: { ...bomData, active: true, items: bomData.items }, include: { items: { include: { material: true } } } })
    : await prisma.billOfMaterials.create({ data: bomData, include: { items: { include: { material: true } } } });

  // Propaga o custo unitário pro produto (mesma fórmula do serviço).
  const raw = bom.items.reduce((acc, i) => acc + Number(i.quantity) * Number(i.material.costPerBaseUnit), 0);
  const unitCost = (raw * 1.08) / 1; // perda 8%, rende 1
  await prisma.product.update({ where: { id: product.id }, data: { costBRL: Math.round(unitCost * 100) / 100 } });

  // 5) Tarifa de entrega própria (faixas moto/carro; limite de volume 6).
  await prisma.deliveryTariff.upsert({
    where: { tenantId },
    update: {
      motoVolumeLimit: 6,
      bands: [
        { modal: "moto", maxKm: 3, priceBRL: 8 },
        { modal: "moto", maxKm: 7, priceBRL: 14 },
        { modal: "moto", maxKm: 12, priceBRL: 20 },
        { modal: "carro", maxKm: 5, priceBRL: 25 },
        { modal: "carro", maxKm: 12, priceBRL: 40 },
        { modal: "carro", maxKm: 25, priceBRL: 70 },
      ],
    },
    create: {
      tenantId, motoVolumeLimit: 6,
      bands: [
        { modal: "moto", maxKm: 3, priceBRL: 8 },
        { modal: "moto", maxKm: 7, priceBRL: 14 },
        { modal: "moto", maxKm: 12, priceBRL: 20 },
        { modal: "carro", maxKm: 5, priceBRL: 25 },
        { modal: "carro", maxKm: 12, priceBRL: 40 },
        { modal: "carro", maxKm: 25, priceBRL: 70 },
      ],
    },
  });

  console.log(`✓ Demo fabricação: produção ligada, ${materialDefs.length} insumos, receita "${bom.name}" (custo R$${(Math.round(unitCost * 100) / 100).toFixed(2)}), tarifa de entrega.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
