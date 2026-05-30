import { test } from "node:test";
import assert from "node:assert/strict";
import { mapOmieProduct, buildOmieRequest, buildOmieOrderPayload, type OmieRawProduct } from "./omie.js";

test("buildOmieRequest: envelope JSON-RPC com auth no corpo e param em array", () => {
  const r = buildOmieRequest("ListarProdutos", { pagina: 1 }, { appKey: "k", appSecret: "s" }) as any;
  assert.equal(r.call, "ListarProdutos");
  assert.equal(r.app_key, "k");
  assert.equal(r.app_secret, "s");
  assert.deepEqual(r.param, [{ pagina: 1 }]);
});

test("mapOmieProduct: codigo_produto→externalId, codigo→sku, valor_unitario→preço", () => {
  const raw: OmieRawProduct = {
    codigo_produto: 12345, codigo: "BOLO-1", descricao: "Bolo de Chocolate",
    valor_unitario: 120.5, descr_detalhada: "massa amanteigada", ean: "7890000000017",
    imagens: [{ url_imagem: "https://cdn/omie.jpg" }],
  };
  const p = mapOmieProduct(raw);
  assert.equal(p.externalId, "12345");
  assert.equal(p.name, "Bolo de Chocolate");
  assert.equal(p.priceBRL, 120.5);
  assert.equal(p.description, "massa amanteigada");
  assert.deepEqual(p.photos, ["https://cdn/omie.jpg"]);
  assert.equal(p.variants.length, 1);
  assert.deepEqual(p.variants[0], { sku: "BOLO-1", color: undefined, size: undefined, stock: 0, barcode: "7890000000017" });
});

test("mapOmieProduct: preço string pt-BR e sem EAN", () => {
  const p = mapOmieProduct({ codigo_produto: 9, codigo: "X1", descricao: "X", valor_unitario: "29,90" });
  assert.equal(p.priceBRL, 29.9);
  assert.equal(p.variants[0]!.barcode, undefined);
});

test("buildOmieOrderPayload: itens viram det[] (produto.codigo=sku)", () => {
  const payload = buildOmieOrderPayload({
    items: [{ sku: "BOLO-1", quantity: 2, unitPriceBRL: 120.5 }],
    shippingZip: "01310100", shippingAddress: {}, totalBRL: 241,
  }) as any;
  assert.equal(payload.det.length, 1);
  assert.equal(payload.det[0].produto.codigo, "BOLO-1");
  assert.equal(payload.det[0].produto.quantidade, 2);
  assert.equal(payload.det[0].produto.valor_unitario, 120.5);
  assert.ok(payload.cabecalho);
});
