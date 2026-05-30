import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteDelivery, DEFAULT_TARIFF, type Tariff } from "./delivery-service.js";

const T: Tariff = {
  motoVolumeLimit: 6,
  bands: [
    { modal: "moto", maxKm: 3, priceBRL: 8 },
    { modal: "moto", maxKm: 7, priceBRL: 14 },
    { modal: "carro", maxKm: 10, priceBRL: 40 },
  ],
};

test("volume baixo → moto; faixa pela distância", () => {
  const q = quoteDelivery({ distanceKm: 2, volume: 1, tariff: T });
  assert.equal(q.modal, "moto");
  assert.equal(q.priceBRL, 8);
  assert.equal(q.outOfRange, false);
});

test("escolhe a menor faixa que cobre a distância", () => {
  const q = quoteDelivery({ distanceKm: 5, volume: 1, tariff: T });
  assert.equal(q.modal, "moto");
  assert.equal(q.priceBRL, 14); // 5km não cabe em 3km, cabe em 7km
  assert.equal(q.maxKm, 7);
});

test("volume acima do limite → carro", () => {
  const q = quoteDelivery({ distanceKm: 8, volume: 10, tariff: T });
  assert.equal(q.modal, "carro");
  assert.equal(q.priceBRL, 40);
});

test("volume exatamente no limite ainda é moto", () => {
  const q = quoteDelivery({ distanceKm: 1, volume: 6, tariff: T });
  assert.equal(q.modal, "moto");
});

test("distância além da maior faixa → usa a maior e marca outOfRange", () => {
  const q = quoteDelivery({ distanceKm: 20, volume: 1, tariff: T });
  assert.equal(q.modal, "moto");
  assert.equal(q.priceBRL, 14); // maior faixa de moto
  assert.equal(q.outOfRange, true);
});

test("modal sem faixa configurada → noTariff, preço 0", () => {
  const q = quoteDelivery({ distanceKm: 5, volume: 50, tariff: { motoVolumeLimit: 6, bands: [{ modal: "moto", maxKm: 5, priceBRL: 10 }] } });
  assert.equal(q.modal, "carro");
  assert.equal(q.noTariff, true);
  assert.equal(q.priceBRL, 0);
});

test("tarifa-padrão: 1 bolo a 4km vai de moto, 10 bolos vão de carro", () => {
  const um = quoteDelivery({ distanceKm: 4, volume: 1, tariff: DEFAULT_TARIFF });
  assert.equal(um.modal, "moto");
  assert.equal(um.priceBRL, 14); // faixa até 7km
  const dez = quoteDelivery({ distanceKm: 4, volume: 10, tariff: DEFAULT_TARIFF });
  assert.equal(dez.modal, "carro");
  assert.equal(dez.priceBRL, 25); // faixa até 5km
});
