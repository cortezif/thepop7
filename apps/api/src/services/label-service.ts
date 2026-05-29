import { getPrisma } from "@thepop/db";

// Arquivo único de etiquetas (barcode F3). Consolida {código, descrição, qtd} num
// único arquivo pra mandar pro fornecedor de etiquetas. Dois formatos:
//  - CSV (universal, abre em qualquer lugar; BOM + ; pro Excel pt-BR)
//  - ZPL (Zebra Programming Language) — uma etiqueta por unidade, com EAN-13 + texto

export type LabelItem = { barcode: string; description: string; variantSku: string; quantity: number };

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV consolidado (1 linha por variante). BOM + ";" pro Excel pt-BR. */
export function labelsToCsv(items: LabelItem[]): string {
  const head = ["codigo_barras", "descricao", "sku", "quantidade"];
  const rows = items.map((i) => [i.barcode, i.description, i.variantSku, i.quantity].map(csvCell).join(";"));
  return "﻿" + [head.join(";"), ...rows].join("\r\n") + "\r\n";
}

/**
 * ZPL: uma etiqueta por unidade (quantity expande). 50x30mm @203dpi aprox.
 * ^BEN = code EAN-13. Mantém simples e portável pra impressora térmica Zebra.
 */
export function labelsToZpl(items: LabelItem[]): string {
  const out: string[] = [];
  for (const it of items) {
    for (let n = 0; n < it.quantity; n++) {
      out.push(
        "^XA",
        "^CI28",                                  // UTF-8
        `^FO30,20^A0N,28,28^FD${zplEscape(it.description).slice(0, 32)}^FS`,
        `^FO30,60^A0N,22,22^FD${zplEscape(it.variantSku)}^FS`,
        `^FO30,100^BY2^BEN,80,Y,N^FD${it.barcode}^FS`, // EAN-13
        "^XZ",
      );
    }
  }
  return out.join("\n") + "\n";
}

function zplEscape(s: string): string {
  return s.replace(/\^/g, " ").replace(/~/g, " ");
}

/**
 * Monta os itens de etiqueta a partir de SKUs de variantes (+ qtd). Resolve
 * código de barras e descrição do catálogo. SKUs sem código são ignorados
 * (devolvidos em `missing` pra avisar o operador).
 */
export async function buildLabelItems(
  tenantId: string,
  requested: Array<{ variantSku: string; quantity: number }>,
): Promise<{ items: LabelItem[]; missing: string[] }> {
  const prisma = getPrisma();
  const skus = requested.map((r) => r.variantSku);
  const [barcodes, products] = await Promise.all([
    prisma.productBarcode.findMany({ where: { tenantId, variantSku: { in: skus } } }),
    prisma.product.findMany({ where: { tenantId }, select: { name: true, variants: true } }),
  ]);
  const barcodeBySku = new Map(barcodes.map((b) => [b.variantSku, b.barcode]));
  const nameBySku = new Map<string, string>();
  for (const p of products) {
    for (const v of ((p.variants as Array<{ sku: string }>) ?? [])) nameBySku.set(v.sku, p.name);
  }

  const items: LabelItem[] = [];
  const missing: string[] = [];
  for (const r of requested) {
    const barcode = barcodeBySku.get(r.variantSku);
    if (!barcode) { missing.push(r.variantSku); continue; }
    items.push({ barcode, description: nameBySku.get(r.variantSku) ?? r.variantSku, variantSku: r.variantSku, quantity: r.quantity });
  }
  return { items, missing };
}
