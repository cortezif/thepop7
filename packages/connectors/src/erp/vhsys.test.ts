import { test } from "node:test";
import assert from "node:assert/strict";
import { mapVhsysProduct, buildVhsysOrderPayload, type VhsysRawProduct } from "./vhsys.js";

test("mapVhsysProduct: id_produtos→externalId, cod_produto→sku, estoque na listagem", () => {
  const raw: VhsysRawProduct = {
    id_produtos: 555, cod_produto: "BOLO-1", nome_produto: "Bolo de Chocolate",
    preco_produto: "120.50", preco_custo_produto: "40.00", estoque_produto: "7",
    cod_barra_produto: "7890000000017", desc_produto: "massa amanteigada",
  };
  const p = mapVhsysProduct(raw);
  assert.equal(p.externalId, "555");
  assert.equal(p.name, "Bolo de Chocolate");
  assert.equal(p.priceBRL, 120.5);
  assert.equal(p.costBRL, 40);
  assert.equal(p.description, "massa amanteigada");
  assert.equal(p.variants.length, 1);
  assert.deepEqual(p.variants[0], { sku: "BOLO-1", color: undefined, size: undefined, stock: 7, barcode: "7890000000017" });
});

test("mapVhsysProduct: preço pt-BR, sem barcode, sem custo → custo undefined", () => {
  const p = mapVhsysProduct({ id_produtos: 9, cod_produto: "X1", nome_produto: "X", preco_produto: "29,90", estoque_produto: 3 });
  assert.equal(p.priceBRL, 29.9);
  assert.equal(p.variants[0]!.stock, 3);
  assert.equal(p.variants[0]!.barcode, undefined);
  assert.equal(p.costBRL, undefined);
});

test("buildVhsysOrderPayload: itens viram produtos[] (cod_produto=sku)", () => {
  const payload = buildVhsysOrderPayload({
    items: [{ sku: "BOLO-1", quantity: 2, unitPriceBRL: 120.5 }],
    shippingZip: "01310100", shippingAddress: {}, totalBRL: 241,
  }) as any;
  assert.equal(payload.produtos.length, 1);
  assert.equal(payload.produtos[0].cod_produto, "BOLO-1");
  assert.equal(payload.produtos[0].quantidade_produto, 2);
  assert.equal(payload.produtos[0].valor_produto, 120.5);
  assert.equal(payload.valor_total, 241);
  assert.equal(payload.cep_endereco_pedido, "01310100");
});
