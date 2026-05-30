import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env") });

import { getPrisma } from "./index.js";
import { encryptPII, hashPII } from "./pii-crypto.js";

const d = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

async function main() {
  const prisma = getPrisma();

  // ── Tenant ──────────────────────────────────────────────────────────────────
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
        "Trata a cliente pelo nome quando souber. Nunca promete prazo que o sistema não calcula.",
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

  // ── Produtos ─────────────────────────────────────────────────────────────────
  const productDefs = [
    {
      externalId: "BL-001",
      name: "Vestido Floral Manga 3/4",
      description: "Vestido midi com estampa floral, manga 3/4, caimento solto.",
      priceBRL: 289.0, costBRL: 102.0,
      styles: ["romantico", "festa", "casamento"],
      occasions: ["casamento", "trabalho"],
      neckline: "medio", sheer: false, length: "medio", sleeveType: "3-4",
      variants: [
        { sku: "BL-001-P-AZUL",  color: "Azul",  size: "P",  stock: 3,  barcode: "7891001000001" },
        { sku: "BL-001-M-AZUL",  color: "Azul",  size: "M",  stock: 1,  barcode: "7891001000002" },
        { sku: "BL-001-G-AZUL",  color: "Azul",  size: "G",  stock: 0,  barcode: "7891001000003" },
        { sku: "BL-001-M-ROSA",  color: "Rosa",  size: "M",  stock: 2,  barcode: "7891001000004" },
      ],
      mainPhoto: "https://placehold.co/800x1200/E94560/FFFFFF?text=Vestido+Floral",
      measurements: {
        P: { bust: 86, waist: 68, hips: 92, length: 98 },
        M: { bust: 92, waist: 74, hips: 98, length: 100 },
        G: { bust: 98, waist: 80, hips: 104, length: 102 },
      },
    },
    {
      externalId: "BL-002",
      name: "Conjunto Alfaiataria Festa",
      description: "Conjunto de alfaiataria preto, corte reto, para eventos formais.",
      priceBRL: 459.0, costBRL: 92.0,
      styles: ["festa", "moderno"],
      occasions: ["casamento", "eventos-formais"],
      neckline: "medio", sheer: false, length: "longo", sleeveType: "longa",
      variants: [
        { sku: "BL-002-M-PRETO", color: "Preto", size: "M", stock: 9, barcode: "7891002000001" },
        { sku: "BL-002-G-PRETO", color: "Preto", size: "G", stock: 8, barcode: "7891002000002" },
      ],
      mainPhoto: "https://placehold.co/800x1200/0F3460/FFFFFF?text=Conjunto+Alfaiataria",
      measurements: {
        M: { bust: 90, waist: 72, hips: 96, length: 110 },
        G: { bust: 96, waist: 78, hips: 102, length: 112 },
      },
    },
    {
      externalId: "BL-003",
      name: "Blusa de Seda Off-White",
      description: "Blusa leve em seda natural, decote V, ideal para dia a dia elegante.",
      priceBRL: 189.0, costBRL: 55.0,
      styles: ["casual", "trabalho", "minimalista"],
      occasions: ["trabalho", "happy-hour"],
      neckline: "decote-v", sheer: false, length: "curto", sleeveType: "manga-curta",
      variants: [
        { sku: "BL-003-P-OFFWHITE", color: "Off-White", size: "P", stock: 6, barcode: "7891003000001" },
        { sku: "BL-003-M-OFFWHITE", color: "Off-White", size: "M", stock: 4, barcode: "7891003000002" },
        { sku: "BL-003-G-OFFWHITE", color: "Off-White", size: "G", stock: 2, barcode: "7891003000003" },
      ],
      mainPhoto: "https://placehold.co/800x1200/F5F5F0/333333?text=Blusa+Seda",
      measurements: {
        P: { bust: 84, waist: 66, hips: 90, length: 58 },
        M: { bust: 90, waist: 72, hips: 96, length: 60 },
        G: { bust: 96, waist: 78, hips: 102, length: 62 },
      },
    },
    {
      externalId: "BL-004",
      name: "Calça Pantalona Estampada",
      description: "Calça pantalona com estampa geométrica, tecido fluido, cintura alta.",
      priceBRL: 319.0, costBRL: 98.0,
      styles: ["boho", "casual", "criativo"],
      occasions: ["trabalho", "passeio"],
      neckline: undefined, sheer: false, length: "longo", sleeveType: undefined,
      variants: [
        { sku: "BL-004-P-ESTAMPADO", color: "Estampado", size: "P", stock: 4, barcode: "7891004000001" },
        { sku: "BL-004-M-ESTAMPADO", color: "Estampado", size: "M", stock: 7, barcode: "7891004000002" },
        { sku: "BL-004-G-ESTAMPADO", color: "Estampado", size: "G", stock: 3, barcode: "7891004000003" },
      ],
      mainPhoto: "https://placehold.co/800x1200/6C5CE7/FFFFFF?text=Calça+Pantalona",
      measurements: {
        P: { waist: 64, hips: 90, length: 102 },
        M: { waist: 70, hips: 96, length: 104 },
        G: { waist: 76, hips: 102, length: 106 },
      },
    },
    {
      externalId: "BL-005",
      name: "Vestido Midi Cetim Verde Oliva",
      description: "Vestido midi de cetim verde oliva, decote reto, alças finas, fenda lateral.",
      priceBRL: 399.0, costBRL: 130.0,
      styles: ["festa", "romantico", "luxo"],
      occasions: ["balada", "jantar", "casamento"],
      neckline: "reto", sheer: false, length: "medio", sleeveType: "sem-manga",
      variants: [
        { sku: "BL-005-P-VERDE", color: "Verde Oliva", size: "P", stock: 2, barcode: "7891005000001" },
        { sku: "BL-005-M-VERDE", color: "Verde Oliva", size: "M", stock: 5, barcode: "7891005000002" },
        { sku: "BL-005-G-VERDE", color: "Verde Oliva", size: "G", stock: 1, barcode: "7891005000003" },
      ],
      mainPhoto: "https://placehold.co/800x1200/2D6A4F/FFFFFF?text=Vestido+Cetim",
      measurements: {
        P: { bust: 82, waist: 64, hips: 88, length: 112 },
        M: { bust: 88, waist: 70, hips: 94, length: 114 },
        G: { bust: 94, waist: 76, hips: 100, length: 116 },
      },
    },
    {
      externalId: "BL-006",
      name: "Blazer Oversized Caramelo",
      description: "Blazer oversized em tecido canelado caramelo, botão único, ombreira marcada.",
      priceBRL: 489.0, costBRL: 155.0,
      styles: ["moderno", "trabalho", "minimalista"],
      occasions: ["trabalho", "reuniao", "eventos-formais"],
      neckline: undefined, sheer: false, length: "curto", sleeveType: "longa",
      variants: [
        { sku: "BL-006-P-CARAMELO",  color: "Caramelo", size: "P",  stock: 3, barcode: "7891006000001" },
        { sku: "BL-006-M-CARAMELO",  color: "Caramelo", size: "M",  stock: 5, barcode: "7891006000002" },
        { sku: "BL-006-G-CARAMELO",  color: "Caramelo", size: "G",  stock: 4, barcode: "7891006000003" },
        { sku: "BL-006-GG-CARAMELO", color: "Caramelo", size: "GG", stock: 2, barcode: "7891006000004" },
      ],
      mainPhoto: "https://placehold.co/800x1200/C4974A/FFFFFF?text=Blazer+Oversized",
      measurements: {
        P:  { bust: 94,  waist: 76, hips: 96,  length: 72 },
        M:  { bust: 100, waist: 82, hips: 102, length: 74 },
        G:  { bust: 106, waist: 88, hips: 108, length: 76 },
        GG: { bust: 112, waist: 94, hips: 114, length: 78 },
      },
    },
    {
      externalId: "BL-007",
      name: "Saia Plissada Mini Rosa",
      description: "Saia plissada mini em chiffon rosa claro, cintura elástica, leve e fluida.",
      priceBRL: 169.0, costBRL: 48.0,
      styles: ["romantico", "casual", "jovem"],
      occasions: ["balada", "passeio", "happy-hour"],
      neckline: undefined, sheer: false, length: "curto", sleeveType: undefined,
      variants: [
        { sku: "BL-007-PP-ROSA", color: "Rosa", size: "PP", stock: 5, barcode: "7891007000001" },
        { sku: "BL-007-P-ROSA",  color: "Rosa", size: "P",  stock: 8, barcode: "7891007000002" },
        { sku: "BL-007-M-ROSA",  color: "Rosa", size: "M",  stock: 6, barcode: "7891007000003" },
        { sku: "BL-007-G-ROSA",  color: "Rosa", size: "G",  stock: 3, barcode: "7891007000004" },
      ],
      mainPhoto: "https://placehold.co/800x1200/FFB3C6/333333?text=Saia+Plissada",
      measurements: {
        PP: { waist: 60, hips: 84, length: 42 },
        P:  { waist: 64, hips: 88, length: 43 },
        M:  { waist: 70, hips: 94, length: 44 },
        G:  { waist: 76, hips: 100, length: 45 },
      },
    },
    {
      externalId: "BL-008",
      name: "Macacão Linho Bege",
      description: "Macacão de linho bege, calça pantalona, alças ajustáveis, bolsos laterais.",
      priceBRL: 359.0, costBRL: 110.0,
      styles: ["casual", "boho", "trabalho"],
      occasions: ["trabalho", "passeio", "praia"],
      neckline: undefined, sheer: false, length: "longo", sleeveType: "sem-manga",
      variants: [
        { sku: "BL-008-P-BEGE", color: "Bege", size: "P", stock: 4, barcode: "7891008000001" },
        { sku: "BL-008-M-BEGE", color: "Bege", size: "M", stock: 6, barcode: "7891008000002" },
        { sku: "BL-008-G-BEGE", color: "Bege", size: "G", stock: 3, barcode: "7891008000003" },
      ],
      mainPhoto: "https://placehold.co/800x1200/D4C5A9/333333?text=Macacão+Linho",
      measurements: {
        P: { bust: 84, waist: 66, hips: 90, length: 140 },
        M: { bust: 90, waist: 72, hips: 96, length: 143 },
        G: { bust: 96, waist: 78, hips: 102, length: 146 },
      },
    },
    {
      externalId: "BL-009",
      name: "Vestido Tubinho Preto",
      description: "Vestido tubinho preto clássico, midi, sem manga, elástico na cintura.",
      priceBRL: 279.0, costBRL: 90.0,
      styles: ["classico", "trabalho", "moderno"],
      occasions: ["trabalho", "jantar", "eventos-formais"],
      neckline: "reto", sheer: false, length: "medio", sleeveType: "sem-manga",
      variants: [
        { sku: "BL-009-P-PRETO",  color: "Preto", size: "P",  stock: 5, barcode: "7891009000001" },
        { sku: "BL-009-M-PRETO",  color: "Preto", size: "M",  stock: 3, barcode: "7891009000002" },
        { sku: "BL-009-G-PRETO",  color: "Preto", size: "G",  stock: 4, barcode: "7891009000003" },
        { sku: "BL-009-GG-PRETO", color: "Preto", size: "GG", stock: 2, barcode: "7891009000004" },
      ],
      mainPhoto: "https://placehold.co/800x1200/1A1A1A/FFFFFF?text=Tubinho+Preto",
      measurements: {
        P:  { bust: 84,  waist: 66, hips: 90,  length: 105 },
        M:  { bust: 90,  waist: 72, hips: 96,  length: 107 },
        G:  { bust: 96,  waist: 78, hips: 102, length: 109 },
        GG: { bust: 102, waist: 84, hips: 108, length: 111 },
      },
    },
    {
      externalId: "BL-010",
      name: "Top Cropped + Saia Midi Jeans",
      description: "Conjunto cropped branco + saia midi jeans lavagem clara, cintura alta.",
      priceBRL: 249.0, costBRL: 75.0,
      styles: ["casual", "jovem", "verao"],
      occasions: ["passeio", "balada", "praia"],
      neckline: "reto", sheer: false, length: "medio", sleeveType: "sem-manga",
      variants: [
        { sku: "BL-010-P-JEANS", color: "Jeans Claro", size: "P", stock: 7, barcode: "7891010000001" },
        { sku: "BL-010-M-JEANS", color: "Jeans Claro", size: "M", stock: 9, barcode: "7891010000002" },
        { sku: "BL-010-G-JEANS", color: "Jeans Claro", size: "G", stock: 5, barcode: "7891010000003" },
      ],
      mainPhoto: "https://placehold.co/800x1200/A8C5DA/333333?text=Cropped+Jeans",
      measurements: {
        P: { bust: 82, waist: 64, hips: 88, length: 95 },
        M: { bust: 88, waist: 70, hips: 94, length: 97 },
        G: { bust: 94, waist: 76, hips: 100, length: 99 },
      },
    },
  ];

  const productMap: Record<string, { id: string; variants: (typeof productDefs[0]["variants"]) }> = {};
  for (const p of productDefs) {
    const product = await prisma.product.upsert({
      where: { tenantId_externalId: { tenantId: tenant.id, externalId: p.externalId } },
      update: {},
      create: {
        tenantId: tenant.id,
        externalId: p.externalId,
        name: p.name,
        description: p.description,
        priceBRL: p.priceBRL,
        costBRL: p.costBRL,
        styles: p.styles,
        occasions: p.occasions,
        neckline: p.neckline,
        sheer: p.sheer,
        length: p.length,
        sleeveType: p.sleeveType,
        variants: p.variants.map(v => ({ sku: v.sku, color: v.color, size: v.size, stock: v.stock })),
        media: { mainPhoto: p.mainPhoto, photos: [], videos: [] },
        measurements: p.measurements,
        enrichmentStatus: "approved",
        active: true,
      },
    });
    productMap[p.externalId] = { id: product.id, variants: p.variants };
  }
  console.log(`✅ ${productDefs.length} produtos`);

  // ── Barcodes ─────────────────────────────────────────────────────────────────
  for (const p of productDefs) {
    const { id: productId, variants } = productMap[p.externalId];
    for (const v of variants) {
      await prisma.productBarcode.upsert({
        where: { tenantId_barcode: { tenantId: tenant.id, barcode: v.barcode } },
        update: {},
        create: { tenantId: tenant.id, barcode: v.barcode, productId, variantSku: v.sku, generated: false },
      });
    }
  }
  console.log("✅ barcodes");

  // ── Fornecedores ─────────────────────────────────────────────────────────────
  const supplierDefs = [
    { name: "Confecções Brás",      phone: "+5511970001111", lead: 5, rel: 0.82, onTime: 0.91, cats: ["vestidos", "blusas"] },
    { name: "Atacado Goiânia Moda", phone: "+5562980002222", lead: 8, rel: 0.65, onTime: 0.78, cats: ["vestidos", "conjuntos"] },
    { name: "Malharia 25 de Março", phone: "+5511960003333", lead: 3, rel: 0.74, onTime: 0.88, cats: ["blusas", "saias"] },
    { name: "Studio Moda Feira",    phone: "+5575990004444", lead: 6, rel: 0.70, onTime: 0.85, cats: ["blazers", "calças"] },
  ];
  const supplierMap: Record<string, string> = {};
  for (const s of supplierDefs) {
    let sup = await prisma.supplier.findFirst({ where: { tenantId: tenant.id, name: s.name } });
    if (!sup) {
      sup = await prisma.supplier.create({
        data: {
          tenantId: tenant.id, name: s.name, contactPhone: s.phone,
          categories: s.cats, avgLeadTimeDays: s.lead,
          relationshipScore: s.rel, onTimeRate: s.onTime, active: true,
        },
      });
    }
    supplierMap[s.name] = sup.id;
  }
  console.log("✅ fornecedores");

  // ── Contatos ─────────────────────────────────────────────────────────────────
  const contactDefs = [
    {
      name: "Ana Carolina Silva", phone: "+5511990011234", email: "ana.carolina@gmail.com",
      igHandle: "anacarolina.style", height: 165, bust: 88, waist: 70, hips: 94, usualSize: "M",
      styles: ["romantico", "casual"], occasions: ["trabalho", "casamento"], colors: ["rosa", "azul"],
    },
    {
      name: "Juliana Moreira", phone: "+5511980022345", email: "ju.moreira@hotmail.com",
      igHandle: "jumoreira_moda", height: 170, bust: 92, waist: 74, hips: 98, usualSize: "M",
      styles: ["festa", "moderno"], occasions: ["eventos-formais", "balada"], colors: ["preto", "verde"],
    },
    {
      name: "Fernanda Costa", phone: "+5521970033456", email: "fernanda.costa@gmail.com",
      igHandle: undefined, height: 158, bust: 84, waist: 66, hips: 90, usualSize: "P",
      styles: ["casual", "boho"], occasions: ["passeio", "trabalho"], colors: ["bege", "terracota"],
    },
    {
      name: "Patricia Almeida", phone: "+5511960044567", email: "patricia.almeida@yahoo.com",
      igHandle: "patalmeida_look", height: 172, bust: 96, waist: 78, hips: 102, usualSize: "G",
      styles: ["trabalho", "minimalista"], occasions: ["trabalho", "reuniao"], colors: ["caramelo", "off-white"],
    },
    {
      name: "Camila Rodrigues", phone: "+5531950055678", email: "camila.rodrigues@gmail.com",
      igHandle: "camilinha.moda", height: 162, bust: 86, waist: 68, hips: 92, usualSize: "M",
      styles: ["jovem", "casual"], occasions: ["balada", "passeio"], colors: ["rosa", "jeans"],
    },
  ];
  const contactMap: Record<string, string> = {};
  for (const c of contactDefs) {
    const phoneHash = hashPII(c.phone)!;
    let contact = await prisma.contact.findFirst({ where: { tenantId: tenant.id, phoneHash } });
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          tenantId: tenant.id,
          phone: encryptPII(c.phone)!, phoneHash,
          email: encryptPII(c.email), emailHash: hashPII(c.email),
          name: c.name, igHandle: c.igHandle,
          height: c.height, bust: c.bust, waist: c.waist, hips: c.hips, usualSize: c.usualSize,
          styles: c.styles, occasions: c.occasions, favoriteColors: c.colors,
          consentLGPD: true, preferredChannel: "whatsapp",
        },
      });
    }
    contactMap[c.name] = contact.id;
  }
  console.log("✅ contatos");

  // ── Entradas de estoque (purchase_in) ────────────────────────────────────────
  for (const p of productDefs) {
    const { id: productId, variants } = productMap[p.externalId];
    for (const v of variants) {
      const qtdInicial = v.stock + 3;
      const already = await prisma.stockMovement.findFirst({
        where: { tenantId: tenant.id, barcode: v.barcode, type: "purchase_in" },
      });
      if (!already) {
        await prisma.stockMovement.create({
          data: {
            tenantId: tenant.id, barcode: v.barcode, productId, variantSku: v.sku,
            type: "purchase_in", quantity: qtdInicial,
            refType: "purchase_request", note: "Recebimento inicial de estoque", actor: "system",
          },
        });
      }
    }
  }
  console.log("✅ movimentos de entrada");

  // ── Pedidos ───────────────────────────────────────────────────────────────────
  type OrderDef = {
    key: string; contactName: string; status: string; paymentMethod: string;
    subtotal: number; shipping: number; shippingCost: number | null; total: number;
    shippingZip: string; paidAt: Date | null; shippedAt?: Date | null;
    deliveredAt?: Date | null; canceledAt?: Date | null; cancelReason?: string;
    carrier?: string; trackingCode?: string; nfeNumber?: string;
    items: { externalId: string; variantSku: string; qty: number; unitPrice: number }[];
  };
  const orderDefs: OrderDef[] = [
    {
      key: "ORD-DEMO-001", contactName: "Ana Carolina Silva", status: "delivered", paymentMethod: "pix",
      items: [
        { externalId: "BL-001", variantSku: "BL-001-M-AZUL",    qty: 1, unitPrice: 289.0 },
        { externalId: "BL-003", variantSku: "BL-003-P-OFFWHITE", qty: 1, unitPrice: 189.0 },
      ],
      subtotal: 478.0, shipping: 18.9, shippingCost: 9.5, total: 496.9, shippingZip: "01310-100",
      paidAt: d(19), shippedAt: d(17), deliveredAt: d(12),
      carrier: "Jadlog", trackingCode: "JD01234567890BR", nfeNumber: "000001",
    },
    {
      key: "ORD-DEMO-002", contactName: "Juliana Moreira", status: "in_transit", paymentMethod: "pix",
      items: [{ externalId: "BL-002", variantSku: "BL-002-M-PRETO", qty: 1, unitPrice: 459.0 }],
      subtotal: 459.0, shipping: 22.5, shippingCost: 11.0, total: 481.5, shippingZip: "04538-133",
      paidAt: d(5), shippedAt: d(3), deliveredAt: null,
      carrier: "Correios", trackingCode: "BR987654321BR",
    },
    {
      key: "ORD-DEMO-003", contactName: "Fernanda Costa", status: "picking", paymentMethod: "card",
      items: [{ externalId: "BL-005", variantSku: "BL-005-P-VERDE", qty: 1, unitPrice: 399.0 }],
      subtotal: 399.0, shipping: 19.9, shippingCost: 10.0, total: 418.9, shippingZip: "22041-011",
      paidAt: d(2), shippedAt: null, deliveredAt: null,
    },
    {
      key: "ORD-DEMO-004", contactName: "Patricia Almeida", status: "finalized", paymentMethod: "pix",
      items: [{ externalId: "BL-006", variantSku: "BL-006-G-CARAMELO", qty: 1, unitPrice: 489.0 }],
      subtotal: 489.0, shipping: 25.0, shippingCost: 12.0, total: 514.0, shippingZip: "01452-000",
      paidAt: d(30), shippedAt: d(28), deliveredAt: d(24),
      carrier: "Melhor Envio", trackingCode: "ME112233445BR", nfeNumber: "000002",
    },
    {
      key: "ORD-DEMO-005", contactName: "Camila Rodrigues", status: "shipped", paymentMethod: "pix",
      items: [
        { externalId: "BL-004", variantSku: "BL-004-M-ESTAMPADO", qty: 1, unitPrice: 319.0 },
        { externalId: "BL-007", variantSku: "BL-007-M-ROSA",       qty: 1, unitPrice: 169.0 },
      ],
      subtotal: 488.0, shipping: 20.0, shippingCost: 10.5, total: 508.0, shippingZip: "30130-010",
      paidAt: d(7), shippedAt: d(5), deliveredAt: null,
      carrier: "Loggi", trackingCode: "LG445566778BR",
    },
    {
      key: "ORD-DEMO-006", contactName: "Ana Carolina Silva", status: "delivered", paymentMethod: "pix",
      items: [{ externalId: "BL-009", variantSku: "BL-009-M-PRETO", qty: 1, unitPrice: 279.0 }],
      subtotal: 279.0, shipping: 16.0, shippingCost: 8.0, total: 295.0, shippingZip: "01310-100",
      paidAt: d(45), shippedAt: d(43), deliveredAt: d(38),
      carrier: "Correios", trackingCode: "BR112233445BR", nfeNumber: "000003",
    },
    {
      key: "ORD-DEMO-007", contactName: "Juliana Moreira", status: "created", paymentMethod: "card",
      items: [
        { externalId: "BL-008", variantSku: "BL-008-M-BEGE",  qty: 1, unitPrice: 359.0 },
        { externalId: "BL-010", variantSku: "BL-010-M-JEANS", qty: 1, unitPrice: 249.0 },
      ],
      subtotal: 608.0, shipping: 28.5, shippingCost: null, total: 636.5, shippingZip: "04538-133",
      paidAt: null,
    },
    {
      key: "ORD-DEMO-008", contactName: "Fernanda Costa", status: "canceled", paymentMethod: "pix",
      items: [{ externalId: "BL-002", variantSku: "BL-002-G-PRETO", qty: 1, unitPrice: 459.0 }],
      subtotal: 459.0, shipping: 22.5, shippingCost: 11.0, total: 481.5, shippingZip: "22041-011",
      paidAt: d(15), canceledAt: d(14), cancelReason: "Cliente desistiu antes da postagem",
    },
  ];

  const orderMap: Record<string, string> = {};
  for (const o of orderDefs) {
    let order = await prisma.order.findFirst({ where: { tenantId: tenant.id, externalId: o.key } });
    if (!order) {
      order = await prisma.order.create({
        data: {
          tenantId: tenant.id,
          contactId: contactMap[o.contactName],
          externalId: o.key,
          status: o.status as any,
          paymentMethod: o.paymentMethod as any,
          subtotalBRL: o.subtotal,
          shippingBRL: o.shipping,
          shippingCostBRL: o.shippingCost ?? undefined,
          totalBRL: o.total,
          shippingZip: o.shippingZip,
          paidAt: o.paidAt ?? undefined,
          shippedAt: o.shippedAt ?? undefined,
          deliveredAt: o.deliveredAt ?? undefined,
          canceledAt: o.canceledAt ?? undefined,
          cancelReason: o.cancelReason,
          carrier: o.carrier,
          trackingCode: o.trackingCode,
          nfeNumber: o.nfeNumber,
          items: {
            create: o.items.map(i => ({
              productId: productMap[i.externalId].id,
              variantSku: i.variantSku,
              quantity: i.qty,
              unitPriceBRL: i.unitPrice,
            })),
          },
        },
      });
    }
    orderMap[o.key] = order.id;
  }
  console.log(`✅ ${orderDefs.length} pedidos`);

  // ── Saídas de estoque (sale_out dos pedidos entregues/enviados) ───────────────
  const ordersSaleOut = ["ORD-DEMO-001", "ORD-DEMO-002", "ORD-DEMO-003", "ORD-DEMO-004", "ORD-DEMO-005", "ORD-DEMO-006"];
  for (const key of ordersSaleOut) {
    const orderId = orderMap[key];
    const orderDef = orderDefs.find(o => o.key === key)!;
    for (const item of orderDef.items) {
      const v = productDefs.find(p => p.externalId === item.externalId)!.variants.find(v => v.sku === item.variantSku)!;
      const already = await prisma.stockMovement.findFirst({
        where: { tenantId: tenant.id, barcode: v.barcode, type: "sale_out", refId: orderId },
      });
      if (!already) {
        await prisma.stockMovement.create({
          data: {
            tenantId: tenant.id, barcode: v.barcode,
            productId: productMap[item.externalId].id, variantSku: item.variantSku,
            type: "sale_out", quantity: item.qty, refType: "order", refId: orderId, actor: "system",
          },
        });
      }
    }
  }
  console.log("✅ movimentos de saída");

  // ── Conversas + Mensagens ────────────────────────────────────────────────────
  type MsgDef = { dir: "in" | "out"; content: string; model?: string; cost?: number };
  const convDefs = [
    {
      contactName: "Ana Carolina Silva", channel: "whatsapp", status: "active",
      summary: "Cliente perguntou sobre tamanho do vestido floral e comprou M Azul.",
      tags: ["venda-concluida", "vestido"],
      startedDaysAgo: 20, lastDaysAgo: 19,
      messages: [
        { dir: "in",  content: "Oi, vim ver o vestido floral que vi no Instagram 😍 Tenho dúvida no tamanho" } as MsgDef,
        { dir: "out", content: "Oi Ana! Que lindo você escolheu 💕 Me diz suas medidas: busto e cintura, e eu te indico o tamanho certinho!", model: "claude-haiku-4-5", cost: 0.002 } as MsgDef,
        { dir: "in",  content: "Tenho 88 de busto e 70 de cintura" } as MsgDef,
        { dir: "out", content: "Perfeito, Ana! O M vai cair muito bem — busto 92cm e cintura 74cm, fica com espaço pra respirar 🌸 Vou separar o M Azul. Aceita PIX?", model: "claude-sonnet-4-6", cost: 0.018 } as MsgDef,
        { dir: "in",  content: "Sim! Manda o PIX" } as MsgDef,
        { dir: "out", content: "Aqui está o QR Code! Valor: R$289,00 🙌 Assim que confirmar, despacho em até 24h.", model: "claude-haiku-4-5", cost: 0.003 } as MsgDef,
      ],
    },
    {
      contactName: "Juliana Moreira", channel: "whatsapp", status: "closed",
      summary: "Cliente comprou Conjunto Alfaiataria M Preto para casamento. Pago por PIX.",
      tags: ["venda-concluida", "conjunto"],
      startedDaysAgo: 6, lastDaysAgo: 5,
      messages: [
        { dir: "in",  content: "Boa tarde! Preciso de um look para casamento, algo mais sofisticado" } as MsgDef,
        { dir: "out", content: "Boa tarde, Juliana! Que emoção, casamento! 🥂 Temos o Conjunto Alfaiataria Festa — preto, corte reto, super elegante. Qual tamanho você usa?", model: "claude-sonnet-4-6", cost: 0.021 } as MsgDef,
        { dir: "in",  content: "Geralmente uso M. Tem no preto?" } as MsgDef,
        { dir: "out", content: "Tem sim! M Preto com 9 unidades ✨ Fica linda, muito versátil. Quer fechar?", model: "claude-haiku-4-5", cost: 0.002 } as MsgDef,
        { dir: "in",  content: "Pode ser! Manda o PIX" } as MsgDef,
        { dir: "out", content: "Pedido registrado! PIX R$459,00. Envio em até 24h 🚀", model: "claude-haiku-4-5", cost: 0.002 } as MsgDef,
      ],
    },
    {
      contactName: "Fernanda Costa", channel: "instagram", status: "handed_off",
      summary: "Reclamação: produto chegou com defeito de costura. Repassado para equipe humana.",
      tags: ["reclamacao", "defeito"],
      startedDaysAgo: 10, lastDaysAgo: 9,
      messages: [
        { dir: "in",  content: "Oi, comprei o vestido semana passada e chegou com a costura aberta 😤" } as MsgDef,
        { dir: "out", content: "Fernanda, que situação horrível, sinto muito! 😔 Pode me mandar uma foto da costura? Vou resolver.", model: "claude-sonnet-4-6", cost: 0.025 } as MsgDef,
        { dir: "in",  content: "[foto da costura com defeito]" } as MsgDef,
        { dir: "out", content: "Confirmo o defeito de fabricação. Vou acionar a equipe de suporte para enviar um novo vestido ainda essa semana, sem custo. Uma pessoa entra em contato em até 2h.", model: "claude-sonnet-4-6", cost: 0.031 } as MsgDef,
      ],
    },
    {
      contactName: "Patricia Almeida", channel: "whatsapp", status: "closed",
      summary: "Recompra do Blazer Oversized G Caramelo. Satisfeita com a primeira compra.",
      tags: ["recompra", "blazer"],
      startedDaysAgo: 32, lastDaysAgo: 31,
      messages: [
        { dir: "in",  content: "Oi! Comprei o blazer caramelo mês passado e amei. Ainda tem no G?" } as MsgDef,
        { dir: "out", content: "Patricia, que ótimo que amou! 🧡 Sim, G Caramelo com 4 unidades. Quer garantir?", model: "claude-haiku-4-5", cost: 0.002 } as MsgDef,
        { dir: "in",  content: "Com certeza! PIX né?" } as MsgDef,
        { dir: "out", content: "Isso! R$489,00 no PIX. Já sei seu endereço da compra anterior 😊", model: "claude-haiku-4-5", cost: 0.002 } as MsgDef,
        { dir: "in",  content: "Manda!" } as MsgDef,
        { dir: "out", content: "Pronto Patricia! Pagamento confirmado 🎉 Envio amanhã.", model: "claude-haiku-4-5", cost: 0.001 } as MsgDef,
      ],
    },
    {
      contactName: "Camila Rodrigues", channel: "whatsapp", status: "active",
      summary: null,
      tags: [],
      startedDaysAgo: 1, lastDaysAgo: 0,
      messages: [
        { dir: "in",  content: "Oi! Vi a calça pantalona estampada e a saia rosa no feed. Combina usar junto?" } as MsgDef,
        { dir: "out", content: "Camila, oi! Que olho de moda 👏 As duas combinam super — estampa geométrica com rosa sólido cria contraste lindo. Quais são seus tamanhos?", model: "claude-sonnet-4-6", cost: 0.019 } as MsgDef,
        { dir: "in",  content: "Uso M nas duas" } as MsgDef,
        { dir: "out", content: "Perfeito! Calça M Estampada (7 em estoque) + Saia M Rosa (6 em estoque) — posso fechar os dois juntos e o frete fica só um 🎀 Quer?", model: "claude-haiku-4-5", cost: 0.003 } as MsgDef,
      ],
    },
  ];

  for (const conv of convDefs) {
    const already = await prisma.conversation.findFirst({
      where: { tenantId: tenant.id, contactId: contactMap[conv.contactName], channel: conv.channel as any },
    });
    if (already) continue;
    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        contactId: contactMap[conv.contactName],
        channel: conv.channel as any,
        status: conv.status as any,
        summary: conv.summary ?? undefined,
        tags: conv.tags,
        startedAt: d(conv.startedDaysAgo),
        lastMessageAt: d(conv.lastDaysAgo),
      },
    });
    for (const m of conv.messages) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: m.dir,
          type: "text",
          content: m.content,
          llmModel: m.model,
          llmCostBRL: m.cost,
          llmInputTokens: m.cost ? Math.round(m.cost * 12000) : undefined,
          llmOutputTokens: m.cost ? Math.round(m.cost * 4000) : undefined,
          reviewFlagged: false,
        },
      });
    }
  }
  console.log(`✅ ${convDefs.length} conversas`);

  // ── Requisições de compra + cotações ─────────────────────────────────────────
  const pr1Exists = await prisma.purchaseRequest.findFirst({
    where: { tenantId: tenant.id, reason: "Reposição BL-001 G Azul e BL-007 PP Rosa abaixo do ponto de pedido" },
  });
  if (!pr1Exists) {
    const pr1 = await prisma.purchaseRequest.create({
      data: {
        tenantId: tenant.id,
        reason: "Reposição BL-001 G Azul e BL-007 PP Rosa abaixo do ponto de pedido",
        status: "quoted",
        items: [
          { sku: "BL-001-G-AZUL", description: "Vestido Floral Manga 3/4 — G Azul", quantity: 5 },
          { sku: "BL-007-PP-ROSA", description: "Saia Plissada Mini Rosa — PP", quantity: 8 },
        ],
      },
    });
    await prisma.quote.create({
      data: {
        tenantId: tenant.id, requestId: pr1.id, supplierId: supplierMap["Confecções Brás"],
        items: [
          { variantSku: "BL-001-G-AZUL", quantity: 5, unitPrice: 98.0 },
          { variantSku: "BL-007-PP-ROSA", quantity: 8, unitPrice: 45.0 },
        ],
        totalBRL: 850.0, leadTimeDays: 5, paymentTerms: "30 dias",
        rawMessage: "Prazo 5 dias úteis. Vestido G Azul R$98 un., Saia PP Rosa R$45 un. Total R$850.",
        score: 0.88, selected: true,
      },
    });
    await prisma.quote.create({
      data: {
        tenantId: tenant.id, requestId: pr1.id, supplierId: supplierMap["Atacado Goiânia Moda"],
        items: [
          { variantSku: "BL-001-G-AZUL", quantity: 5, unitPrice: 105.0 },
          { variantSku: "BL-007-PP-ROSA", quantity: 8, unitPrice: 52.0 },
        ],
        totalBRL: 941.0, leadTimeDays: 8, paymentTerms: "À vista",
        rawMessage: "Prazo 8 dias. Vestido G R$105, Saia PP R$52. Total R$941.",
        score: 0.64, selected: false,
      },
    });
  }

  const pr2Exists = await prisma.purchaseRequest.findFirst({
    where: { tenantId: tenant.id, reason: "Reposição urgente BL-005 Vestido Cetim Verde Oliva" },
  });
  if (!pr2Exists) {
    const pr2 = await prisma.purchaseRequest.create({
      data: {
        tenantId: tenant.id,
        reason: "Reposição urgente BL-005 Vestido Cetim Verde Oliva",
        status: "open",
        items: [
          { sku: "BL-005-P-VERDE", description: "Vestido Midi Cetim Verde Oliva — P", quantity: 4 },
          { sku: "BL-005-G-VERDE", description: "Vestido Midi Cetim Verde Oliva — G", quantity: 3 },
        ],
      },
    });
    await prisma.quote.create({
      data: {
        tenantId: tenant.id, requestId: pr2.id, supplierId: supplierMap["Studio Moda Feira"],
        items: [
          { variantSku: "BL-005-P-VERDE", quantity: 4, unitPrice: 125.0 },
          { variantSku: "BL-005-G-VERDE", quantity: 3, unitPrice: 125.0 },
        ],
        totalBRL: 875.0, leadTimeDays: 6, paymentTerms: "50% entrada, 50% na entrega",
        rawMessage: "R$125 por unidade, prazo 6 dias úteis. Total R$875.",
        score: 0.79, selected: false,
      },
    });
  }
  console.log("✅ compras + cotações");

  // ── NPS ───────────────────────────────────────────────────────────────────────
  const npsDefs = [
    { contactName: "Ana Carolina Silva",  orderKey: "ORD-DEMO-001", kind: "produto",      score: 9,  comment: "Vestido lindo, caimento perfeito!" },
    { contactName: "Ana Carolina Silva",  orderKey: "ORD-DEMO-001", kind: "atendimento",  score: 10, comment: "Maya foi incrível, super rápida!" },
    { contactName: "Patricia Almeida",    orderKey: "ORD-DEMO-004", kind: "produto",      score: 8,  comment: "Blazer maravilhoso, só achei um pouco quente." },
    { contactName: "Patricia Almeida",    orderKey: "ORD-DEMO-004", kind: "atendimento",  score: 9,  comment: "Atendimento ágil e simpático." },
    { contactName: "Ana Carolina Silva",  orderKey: "ORD-DEMO-006", kind: "produto",      score: 10, comment: "O tubinho é perfeito, já usei 3 vezes!" },
    { contactName: "Ana Carolina Silva",  orderKey: "ORD-DEMO-006", kind: "atendimento",  score: 9,  comment: "Processo muito fácil." },
  ];
  for (const n of npsDefs) {
    const already = await prisma.npsResponse.findFirst({
      where: { tenantId: tenant.id, contactId: contactMap[n.contactName], orderId: orderMap[n.orderKey], kind: n.kind },
    });
    if (!already) {
      await prisma.npsResponse.create({
        data: {
          tenantId: tenant.id,
          contactId: contactMap[n.contactName],
          orderId: orderMap[n.orderKey],
          kind: n.kind, score: n.score, comment: n.comment,
        },
      });
    }
  }
  console.log("✅ NPS");

  console.log("\n✅ Seed completo — 10 produtos · 5 contatos · 8 pedidos · 5 conversas · 2 requisições de compra · NPS");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await getPrisma().$disconnect(); });
