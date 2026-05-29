import { getPrisma, withTenant } from "@thepop/db";
import { resolveBarcode, normalizeBarcode, isValidEan13 } from "@thepop/shared";

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

/** Resolve um código bipado → produto + variante (scan O(1)). */
export async function resolveScannedBarcode(tenantId: string, code: string) {
  const barcode = normalizeBarcode(code);
  const row = await getPrisma().productBarcode.findUnique({
    where: { tenantId_barcode: { tenantId, barcode } },
  });
  if (!row) return null;
  const product = await getPrisma().product.findUnique({
    where: { id: row.productId },
    select: { id: true, name: true, variants: true },
  });
  if (!product) return null;
  const variant = ((product.variants as Variant[]) ?? []).find((v) => v.sku === row.variantSku) ?? null;
  return { barcode, productId: product.id, productName: product.name, variantSku: row.variantSku, variant };
}
