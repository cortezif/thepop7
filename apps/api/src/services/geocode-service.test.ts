import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCep, parseNominatim, parseGoogleGeocode, buildAddressQueries } from "./geocode-service.js";

test("buildAddressQueries: progressivo (rua→bairro→cidade) a partir do ViaCEP", () => {
  assert.deepEqual(
    buildAddressQueries({ logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP" }),
    [
      "Avenida Paulista, Bela Vista, São Paulo, SP, Brasil",
      "Bela Vista, São Paulo, SP, Brasil",
      "São Paulo, SP, Brasil",
    ],
  );
  // CEP geral (sem logradouro/bairro) → só cidade/uf
  assert.deepEqual(buildAddressQueries({ logradouro: "", bairro: "", localidade: "Campinas", uf: "SP" }), ["Campinas, SP, Brasil"]);
  // erro do ViaCEP → vazio
  assert.deepEqual(buildAddressQueries({ erro: true }), []);
  assert.deepEqual(buildAddressQueries(null), []);
});

test("normalizeCep: só dígitos, 8 chars", () => {
  assert.equal(normalizeCep("01310-100"), "01310100");
  assert.equal(normalizeCep("01310100extra"), "01310100");
  assert.equal(normalizeCep("abc"), "");
});

test("parseNominatim: extrai lat/lng do 1º resultado", () => {
  const c = parseNominatim([{ lat: "-23.5613", lon: "-46.6565", display_name: "Av. Paulista, SP" }]);
  assert.deepEqual(c, { lat: -23.5613, lng: -46.6565, label: "Av. Paulista, SP" });
});

test("parseNominatim: vazio/ inválido → null", () => {
  assert.equal(parseNominatim([]), null);
  assert.equal(parseNominatim([{ lat: "x", lon: "y" }]), null);
  assert.equal(parseNominatim(null), null);
});

test("parseGoogleGeocode: extrai location do 1º result", () => {
  const c = parseGoogleGeocode({ results: [{ geometry: { location: { lat: -23.56, lng: -46.65 } }, formatted_address: "SP, Brasil" }] });
  assert.deepEqual(c, { lat: -23.56, lng: -46.65, label: "SP, Brasil" });
});

test("parseGoogleGeocode: sem results → null", () => {
  assert.equal(parseGoogleGeocode({ results: [] }), null);
  assert.equal(parseGoogleGeocode({}), null);
});
