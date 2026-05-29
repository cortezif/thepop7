import { test } from "node:test";
import assert from "node:assert/strict";
import { mapTrayProduct, buildTrayOrderPayload, type TrayRawProduct } from "./tray.js";

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

test("mapTrayProduct: lê o EAN da variante quando a Tray fornece", () => {
  const raw: TrayRawProduct = {
    id: 5, name: "Camisa", price: 90,
    Variant: [{ Variant: { sku: "C-P", ean: "7891234567895", stock: 4 } }],
  };
  assert.equal(mapTrayProduct(raw).variants[0]!.barcode, "7891234567895");
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

test("buildTrayOrderPayload: itens viram ProductsSold (reference=sku) + endereço/frete", () => {
  const payload = buildTrayOrderPayload({
    contactName: "Ana", contactPhone: "11999990000",
    items: [
      { sku: "VF-M-AZ", quantity: 2, unitPriceBRL: 199.9 },
      { sku: "BOLSA-1", quantity: 1, unitPriceBRL: 120 },
    ],
    shippingZip: "01310-100",
    shippingAddress: { address: "Av Paulista", number: "1000", neighborhood: "Bela Vista", city: "São Paulo", state: "SP", cpf: "12345678900" },
    totalBRL: 519.8,
  }) as any;

  assert.equal(payload.Order.Customer.name, "Ana");
  assert.equal(payload.Order.Customer.cellphone, "11999990000");
  assert.equal(payload.Order.Customer.cpf, "12345678900");
  assert.equal(payload.Order.ProductsSold.length, 2);
  assert.deepEqual(payload.Order.ProductsSold[0].ProductsSold, { reference: "VF-M-AZ", quantity: 2, price: 199.9 });
  assert.equal(payload.Order.total, 519.8);
  assert.equal(payload.Order.zip_code, "01310-100");
  assert.equal(payload.Order.address, "Av Paulista");
  assert.equal(payload.Order.city, "São Paulo");
  assert.equal(payload.Order.state, "SP");
});

test("buildTrayOrderPayload: campos opcionais ausentes → undefined, sem quebrar", () => {
  const payload = buildTrayOrderPayload({
    items: [{ sku: "X1", quantity: 1, unitPriceBRL: 50 }],
    shippingZip: "00000-000",
    shippingAddress: {},
    totalBRL: 50,
  }) as any;
  assert.equal(payload.Order.Customer.name, "Cliente"); // default
  assert.equal(payload.Order.Customer.cpf, undefined);
  assert.equal(payload.Order.address, undefined);
  assert.equal(payload.Order.ProductsSold[0].ProductsSold.reference, "X1");
});
