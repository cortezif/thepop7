import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCplugNfePayload, normalizeNfeResult } from "./cplug.js";
import type { NfeInput } from "../types.js";

const baseInput: NfeInput = {
  orderId: "ord_42",
  customer: {
    name: "Ana Souza",
    document: "12345678900",
    email: "ana@example.com",
    address: { zip: "01310-100", address: "Av Paulista", number: "1000", neighborhood: "Bela Vista", city: "São Paulo", state: "SP" },
  },
  items: [
    { description: "Vestido Floral", sku: "VF-M-AZ", quantity: 2, unitPriceBRL: 199.9, ncm: "61046200", cfop: "5102" },
    { description: "Bolsa", sku: "BOLSA-1", quantity: 1, unitPriceBRL: 120 },
  ],
  totalBRL: 519.8,
};

test("buildCplugNfePayload: cliente + itens (code=sku) + total + referência", () => {
  const p = buildCplugNfePayload(baseInput) as any;
  assert.equal(p.external_reference, "ord_42");
  assert.equal(p.customer.name, "Ana Souza");
  assert.equal(p.customer.document, "12345678900");
  assert.equal(p.customer.city, "São Paulo");
  assert.equal(p.customer.zip_code, "01310-100");
  assert.equal(p.items.length, 2);
  assert.deepEqual(p.items[0], { description: "Vestido Floral", code: "VF-M-AZ", quantity: 2, unit_price: 199.9, ncm: "61046200", cfop: "5102" });
  assert.equal(p.items[1].ncm, undefined); // opcional ausente
  assert.equal(p.total, 519.8);
});

test("normalizeNfeResult: aceita variações de nome de campo", () => {
  assert.deepEqual(
    normalizeNfeResult({ number: 123, xml_url: "x.xml", pdf_url: "x.pdf" }, "ord_1"),
    { number: "123", xmlUrl: "x.xml", pdfUrl: "x.pdf" },
  );
  assert.deepEqual(
    normalizeNfeResult({ Nfe: { number: "456", xml_url: "y.xml", pdf_url: "y.pdf" } }, "ord_2"),
    { number: "456", xmlUrl: "y.xml", pdfUrl: "y.pdf" },
  );
  // danfe_url como pdf, sem xml → xml vazio
  assert.deepEqual(
    normalizeNfeResult({ nfe_number: 789, danfe_url: "z.pdf" }, "ord_3"),
    { number: "789", xmlUrl: "", pdfUrl: "z.pdf" },
  );
});

test("normalizeNfeResult: sem número → erro", () => {
  assert.throws(() => normalizeNfeResult({ xml_url: "x.xml" }, "ord_x"), /sem número da nota/);
});
