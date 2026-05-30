import { test } from "node:test";
import assert from "node:assert/strict";
import { mapBlingProduct, buildBlingOrderPayload, type BlingRawProduct } from "./bling.js";

test("mapBlingProduct: produto com variações (cor/tamanho/estoque/EAN)", () => {
  const raw: BlingRawProduct = {
    id: 101,
    nome: "Vestido Floral",
    descricaoCurta: "Vestido midi",
    preco: 199.9,
    precoCusto: 80,
    midia: { imagens: { externas: [{ link: "https://cdn/img1.jpg" }], internas: [{ link: "https://cdn/img2.jpg" }] } },
    variacoes: [
      { codigo: "VF-M-AZ", gtin: "7891234567895", estoque: { saldoVirtualTotal: 3 }, variacao: { nome: "Cor:Azul;Tamanho:M" } },
      { codigo: "VF-G-AZ", estoque: { saldoVirtualTotal: 0 }, variacao: { nome: "Tamanho:G;Cor:Azul" } },
    ],
  };
  const p = mapBlingProduct(raw);
  assert.equal(p.externalId, "101");
  assert.equal(p.name, "Vestido Floral");
  assert.equal(p.priceBRL, 199.9);
  assert.equal(p.costBRL, 80);
  assert.deepEqual(p.photos, ["https://cdn/img1.jpg", "https://cdn/img2.jpg"]);
  assert.equal(p.variants.length, 2);
  assert.deepEqual(p.variants[0], { sku: "VF-M-AZ", color: "Azul", size: "M", stock: 3, barcode: "7891234567895" });
  assert.equal(p.variants[1]!.stock, 0); // sem estoque preservado
  assert.equal(p.variants[1]!.size, "G");
  assert.equal(p.variants[1]!.color, "Azul");
});

test("mapBlingProduct: produto simples (sem variações) vira 1 variante pelo código", () => {
  const raw: BlingRawProduct = { id: 7, nome: "Bolsa", preco: 120, codigo: "BOLSA-1", estoque: { saldoVirtualTotal: 5 } };
  const p = mapBlingProduct(raw);
  assert.equal(p.variants.length, 1);
  assert.deepEqual(p.variants[0], { sku: "BOLSA-1", color: undefined, size: undefined, stock: 5 });
  assert.equal(p.costBRL, undefined); // sem precoCusto → indefinido (não 0)
});

test("mapBlingProduct: estoque como número cru e preço string pt-BR", () => {
  const raw: BlingRawProduct = { id: 9, nome: "Caneca", preco: "29,90", codigo: "CAN-1", estoque: 8, gtin: "7890000000017" };
  const p = mapBlingProduct(raw);
  assert.equal(p.priceBRL, 29.9);
  assert.equal(p.variants[0]!.stock, 8);
  assert.equal(p.variants[0]!.barcode, "7890000000017");
});

test("mapBlingProduct: campos numéricos sujos → 0, sem quebrar", () => {
  const raw: BlingRawProduct = { id: 3, nome: "X", preco: "abc", codigo: "X1", estoque: { saldoVirtualTotal: undefined } };
  const p = mapBlingProduct(raw);
  assert.equal(p.priceBRL, 0);
  assert.equal(p.variants[0]!.stock, 0);
});

test("buildBlingOrderPayload: itens viram `itens` (codigo=sku) + contato + endereço", () => {
  const payload = buildBlingOrderPayload({
    contactName: "Ana", contactPhone: "11999990000",
    items: [
      { sku: "VF-M-AZ", quantity: 2, unitPriceBRL: 199.9 },
      { sku: "BOLSA-1", quantity: 1, unitPriceBRL: 120 },
    ],
    shippingZip: "01310-100",
    shippingAddress: { address: "Av Paulista", number: "1000", neighborhood: "Bela Vista", city: "São Paulo", state: "SP", cpf: "12345678900" },
    totalBRL: 519.8,
  }) as any;

  assert.equal(payload.contato.nome, "Ana");
  assert.equal(payload.contato.telefone, "11999990000");
  assert.equal(payload.contato.numeroDocumento, "12345678900");
  assert.equal(payload.itens.length, 2);
  assert.deepEqual(payload.itens[0], { codigo: "VF-M-AZ", descricao: "VF-M-AZ", quantidade: 2, valor: 199.9 });
  assert.equal(payload.total, 519.8);
  assert.equal(payload.transporte.etiqueta.cep, "01310-100");
  assert.equal(payload.transporte.etiqueta.municipio, "São Paulo");
  assert.equal(payload.transporte.etiqueta.uf, "SP");
});

test("buildBlingOrderPayload: opcionais ausentes → contato default, sem quebrar", () => {
  const payload = buildBlingOrderPayload({
    items: [{ sku: "X1", quantity: 1, unitPriceBRL: 50 }],
    shippingZip: "00000-000",
    shippingAddress: {},
    totalBRL: 50,
  }) as any;
  assert.equal(payload.contato.nome, "Cliente"); // default
  assert.equal(payload.contato.numeroDocumento, undefined);
  assert.equal(payload.transporte.etiqueta.endereco, undefined);
  assert.equal(payload.itens[0].codigo, "X1");
});
