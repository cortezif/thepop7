import { getPrisma, withTenant } from "@hubadvisor/db";
import { resolveBarcode, normalizeBarcode, isValidEan13 } from "@hubadvisor/shared";
import { extractProductAttributes } from "@hubadvisor/agent";
import { searchProducts } from "./product-search.js";

// Atribuição/sincronização de códigos de barras (F0/F1).
// Decisão: usa o GTIN/EAN que veio da Tray/CPlug (gravado em Product.variants[].barcode);
// gera EAN-13 interno (prefixo 2) só pro que faltar. Mantém a tabela de lookup
// `ProductBarcode` em sincronia (scan O(1) + unicidade por tenant).

type Variant = { sku: string; barcode?: string; [k: string]: unknown };

/** Próximo sequencial pra códigos internos: continua de onde parou (sem colisão). */
async function nextInternalSeq(tenantId: string): Promise<number> {
  const count = await getPrisma().productBarcode.count({ where: { tenantId, generated: true } });
  return count; // resolveBarcode incrementa antes de usar (+1)
}

export type BackfillResult = {
  produtos: number;
  variantes: number;
  jaTinham: number;     // já tinham EAN válido (Tray/CPlug)
  gerados: number;      // EAN interno gerado agora
  lookupSincronizado: number;
};

/** Garante código em toda variante e espelha na tabela de lookup. Idempotente. */
export async function backfillBarcodes(tenantId: string): Promise<BackfillResult> {
  const prisma = getPrisma();
  const products = await prisma.product.findMany({ where: { tenantId } });
  const existing = await prisma.productBarcode.findMany({ where: { tenantId }, select: { barcode: true } });
  const used = new Set(existing.map((b) => b.barcode));

  let seq = await nextInternalSeq(tenantId);
  const res: BackfillResult = { produtos: products.length, variantes: 0, jaTinham: 0, gerados: 0, lookupSincronizado: 0 };

  for (const p of products) {
    const variants = ((p.variants as Variant[]) ?? []);
    let changed = false;

    for (const v of variants) {
      res.variantes++;
      const current = normalizeBarcode(v.barcode);
      let barcode: string;

      if (isValidEan13(current)) {
        barcode = current;
        res.jaTinham++;
      } else {
        // gera interno, pulando colisões
        let out = resolveBarcode("", seq + 1);
        while (used.has(out.barcode)) { seq++; out = resolveBarcode("", seq + 1); }
        seq++;
        barcode = out.barcode;
        res.gerados++;
      }

      if (v.barcode !== barcode) { v.barcode = barcode; changed = true; }
      used.add(barcode);

      // espelha no lookup (idempotente por unique [tenantId, barcode])
      await withTenant(tenantId, async (tx) => {
        await tx.productBarcode.upsert({
          where: { tenantId_barcode: { tenantId, barcode } },
          create: { tenantId, barcode, productId: p.id, variantSku: v.sku, generated: !isValidEan13(current) },
          update: { productId: p.id, variantSku: v.sku },
        });
      });
      res.lookupSincronizado++;
    }

    if (changed) {
      await withTenant(tenantId, async (tx) => {
        await tx.product.update({ where: { id: p.id }, data: { variants: variants as any } });
      });
    }
  }

  return res;
}

/** Foto da peça: foto da variante (se houver) cai pra foto principal do produto. */
function photoOf(media: unknown, variant: Variant | null): string | null {
  const vPhoto = variant && typeof variant.photo === "string" ? variant.photo : null;
  const main = (media as { mainPhoto?: string; photos?: string[] } | null)?.mainPhoto
    ?? (media as { photos?: string[] } | null)?.photos?.[0];
  return vPhoto ?? main ?? null;
}

/** Resolve um código bipado → produto + variante + FOTO (scan O(1)). barcode→imagem. */
export async function resolveScannedBarcode(tenantId: string, code: string) {
  const barcode = normalizeBarcode(code);
  const row = await getPrisma().productBarcode.findUnique({
    where: { tenantId_barcode: { tenantId, barcode } },
  });
  if (!row) return null;
  const product = await getPrisma().product.findUnique({
    where: { id: row.productId },
    select: { id: true, name: true, variants: true, media: true },
  });
  if (!product) return null;
  const variant = ((product.variants as Variant[]) ?? []).find((v) => v.sku === row.variantSku) ?? null;
  return {
    barcode, productId: product.id, productName: product.name,
    variantSku: row.variantSku, variant, photo: photoOf(product.media, variant),
  };
}

/**
 * Busca o código de barras A PARTIR DA FOTO da peça (imagem→código). Reusa a
 * visão (`extractProductAttributes`) + busca por atributos do catálogo, e devolve
 * os candidatos com seus códigos de barras e foto. Gracioso se a visão falhar.
 */
export async function findBarcodesByPhoto(tenantId: string, photoUrls: string[]) {
  if (!photoUrls?.length) return { ok: false as const, error: "nenhuma foto enviada", candidatos: [] };

  const extraction = await extractProductAttributes({ productName: "peça da foto", photoUrls });
  if (!extraction.ok) return { ok: false as const, error: `falha na análise da foto: ${extraction.error}`, candidatos: [] };
  const a = extraction.attributes;

  const intent = [...a.styles, ...a.occasions, `decote ${a.neckline}`, `comprimento ${a.length}`, `manga ${a.sleeveType}`]
    .filter(Boolean).join(" ");
  const hits = await searchProducts(tenantId, intent, { estilo: a.styles, ocasiao: a.occasions }, 5);

  // códigos de barras das variantes dos candidatos (lookup por SKU)
  const skus = hits.flatMap((h) => (h.variants ?? []).map((v) => v.sku));
  const barcodes = await getPrisma().productBarcode.findMany({ where: { tenantId, variantSku: { in: skus } } });
  const bySku = new Map(barcodes.map((b) => [b.variantSku, b.barcode]));

  const candidatos = hits.map((h) => ({
    productId: h.externalId,
    name: h.name,
    priceBRL: h.priceBRL,
    score: (h as { businessScore?: number }).businessScore ?? null,
    mainPhoto: h.mainPhoto ?? null,
    variantes: (h.variants ?? []).map((v) => ({ sku: v.sku, color: v.color, size: v.size, barcode: bySku.get(v.sku) ?? null })),
  }));
  return { ok: true as const, atributosDetectados: a, candidatos };
}
