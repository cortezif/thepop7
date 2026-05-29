import { test } from "node:test";
import assert from "node:assert/strict";
import { labelsToCsv, labelsToZpl, type LabelItem } from "./label-service.js";

const items: LabelItem[] = [
  { barcode: "2000000000015", description: "Vestido Floral", variantSku: "VF-M-AZ", quantity: 2 },
  { barcode: "2000000000022", description: 'Bolsa; "Couro"', variantSku: "BOLSA-1", quantity: 1 },
];

test("labelsToCsv: cabeçalho + linhas + escape de ; e aspas + BOM", () => {
  const csv = labelsToCsv(items);
  assert.ok(csv.startsWith("﻿")); // BOM
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], "codigo_barras;descricao;sku;quantidade");
  assert.equal(lines[1], "2000000000015;Vestido Floral;VF-M-AZ;2");
  assert.match(lines[2]!, /^2000000000022;"Bolsa; ""Couro""";BOLSA-1;1$/); // campo com ; e " escapado
});

test("labelsToZpl: uma etiqueta por unidade (quantity expande) + EAN-13", () => {
  const zpl = labelsToZpl(items);
  const etiquetas = zpl.match(/\^XA/g) ?? [];
  assert.equal(etiquetas.length, 3); // 2 + 1
  assert.match(zpl, /\^BEN,80,Y,N\^FD2000000000015/); // código de barras EAN-13
  assert.ok(zpl.includes("^XZ"));
});

test("labelsToZpl: escapa ^ e ~ da descrição (não quebra o ZPL)", () => {
  const zpl = labelsToZpl([{ barcode: "2000000000039", description: "A^B~C", variantSku: "X", quantity: 1 }]);
  assert.ok(!/FDA\^B/.test(zpl)); // ^ não aparece cru no campo
});
