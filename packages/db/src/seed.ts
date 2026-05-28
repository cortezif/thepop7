import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env") });

import { getPrisma } from "./index.js";

async function main() {
  const prisma = getPrisma();

  const tenant = await prisma.tenant.upsert({
    where: { slug: "thepop7" },
    update: {},
    create: {
      slug: "thepop7",
      name: "The Pop 7",
      status: "active",
      agentPersona: "Maya",
      agentTone:
        "Acolhedora, próxima, brasileira do dia a dia. Usa emojis com parcimônia. " +
        "Trata a cliente pelo nome quando souber. Nunca prometo prazo que o sistema não calcula.",
      policies: {
        prazoDevolucao: 7,
        cancelamentoSemPostagem: true,
        formasDePagamento: ["PIX", "cartão até 3x sem juros"],
      },
      recoMarginWeight: 0.2,
      recoStockWeight: 0.25,
      recoProfileWeight: 0.45,
    },
  });

  await prisma.product.upsert({
    where: { tenantId_externalId: { tenantId: tenant.id, externalId: "BL-001" } },
    update: {},
    create: {
      tenantId: tenant.id,
      externalId: "BL-001",
      name: "Vestido Floral Manga 3/4",
      description: "Vestido midi com estampa floral, manga 3/4, caimento solto.",
      priceBRL: 289.0,
      costBRL: 102.0,
      styles: ["romantico", "festa", "casamento"],
      occasions: ["casamento", "trabalho"],
      neckline: "medio",
      sheer: false,
      length: "medio",
      sleeveType: "3-4",
      variants: [
        { sku: "BL-001-P-AZUL",  color: "Azul",  size: "P",  stock: 3 },
        { sku: "BL-001-M-AZUL",  color: "Azul",  size: "M",  stock: 1 },
        { sku: "BL-001-G-AZUL",  color: "Azul",  size: "G",  stock: 0 },
        { sku: "BL-001-M-ROSA",  color: "Rosa",  size: "M",  stock: 2 },
      ],
      media: {
        mainPhoto: "https://placehold.co/800x1200/E94560/FFFFFF?text=Vestido+Floral",
        photos: [],
        videos: [],
      },
      enrichmentStatus: "approved",
      active: true,
    },
  });

  await prisma.product.upsert({
    where: { tenantId_externalId: { tenantId: tenant.id, externalId: "BL-002" } },
    update: {},
    create: {
      tenantId: tenant.id,
      externalId: "BL-002",
      name: "Conjunto Alfaiataria Festa",
      description: "Conjunto de alfaiataria preto, corte reto, para eventos formais.",
      priceBRL: 459.0,
      costBRL: 92.0,
      styles: ["festa", "moderno"],
      occasions: ["casamento", "eventos-formais"],
      neckline: "medio",
      sheer: false,
      length: "longo",
      sleeveType: "longa",
      variants: [
        { sku: "BL-002-M-PRETO", color: "Preto", size: "M", stock: 9 },
        { sku: "BL-002-G-PRETO", color: "Preto", size: "G", stock: 8 },
      ],
      media: {
        mainPhoto: "https://placehold.co/800x1200/0F3460/FFFFFF?text=Conjunto+Alfaiataria",
        photos: [],
        videos: [],
      },
      enrichmentStatus: "approved",
      active: true,
    },
  });

  // Fornecedores pra testar cotação
  const suppliers = [
    { name: "Confecções Brás", phone: "+5511970001111", lead: 5, rel: 0.8 },
    { name: "Atacado Goiânia Moda", phone: "+5562980002222", lead: 8, rel: 0.6 },
    { name: "Malharia 25 de Março", phone: "+5511960003333", lead: 3, rel: 0.7 },
  ];
  for (const s of suppliers) {
    const existing = await prisma.supplier.findFirst({ where: { tenantId: tenant.id, name: s.name } });
    if (!existing) {
      await prisma.supplier.create({
        data: {
          tenantId: tenant.id, name: s.name, contactPhone: s.phone,
          categories: ["vestidos", "moda feminina"],
          avgLeadTimeDays: s.lead, relationshipScore: s.rel, onTimeRate: 0.9,
        },
      });
    }
  }

  console.log("Seeded tenant:", tenant.slug, "+ 3 fornecedores");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
