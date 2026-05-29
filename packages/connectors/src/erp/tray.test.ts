import { test } from "node:test";
import assert from "node:assert/strict";
import { mapTrayProduct, type TrayRawProduct } from "./tray.js";

test("mapTrayProduct: produto com variantes (cor/tamanho/estoque)", () => {
  const raw: TrayRawProduct = {
    id: 101,
    name: "Vestido Floral",
    description: "Vestido midi",
    price: "199,90",
    cost_price: "80,00",
    ProductImage: [{ https: "https://cdn/img1.jpg" }, { http: "http://cdn/img2.jpg" }],
    Variant: [
      { Variant: { sku: "VF-M-AZ", stock: "3", ValuesVariant: [{ type: "Tamanho", value: "M" }, { type: "Cor", value: "Azul" }] } },
      { Variant: { sku: "VF-G-AZ", stock: 0, ValuesVariant: [{ type: "tamanho", value: "G" }, { type: "cor", value: "Azul" }] } },
    ],
  };
  const p = mapTrayProduct(raw);
  assert.equal(p.externalId, "101");
  assert.equal(p.name, "Vestido Floral");
  assert.equal(p.priceBRL, 199.9);       // vírgula decimal pt-BR convertida
  assert.equal(p.costBRL, 80);
  assert.deepEqual(p.photos, ["https://cdn/img1.jpg", "http://cdn/img2.jpg"]);
  assert.equal(p.variants.length, 2);
  const [v0, v1] = p.variants;
  assert.deepEqual(v0, { sku: "VF-M-AZ", color: "Azul", size: "M", stock: 3 });
  assert.equal(v1!.stock, 0);  // sem estoque preservado
  assert.equal(v1!.size, "G");
});

test("mapTrayProduct: produto sem variantes vira 1 variante pelo reference", () => {
  const raw: TrayRawProduct = { id: 7, name: "Bolsa", price: 120, reference: "BOLSA-1", stock: "5" };
  const p = mapTrayProduct(raw);
  assert.equal(p.variants.length, 1);
  assert.deepEqual(p.variants[0], { sku: "BOLSA-1", color: undefined, size: undefined, stock: 5 });
  assert.equal(p.costBRL, undefined); // sem cost_price → indefinido (não 0)
});

test("mapTrayProduct: campos numéricos sujos → 0, sem quebrar", () => {
  const raw: TrayRawProduct = { id: 9, name: "X", price: "abc", Variant: [{ Variant: { sku: "X1", stock: undefined } }] };
  const p = mapTrayProduct(raw);
  assert.equal(p.priceBRL, 0);
  assert.equal(p.variants[0]!.stock, 0);
});
