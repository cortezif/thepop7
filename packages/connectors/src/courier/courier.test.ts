import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  lalamoveSignature, lalamoveServiceType, buildLalamoveQuoteBody,
  parseLalamoveQuote, buildLalamoveOrderBody, normalizeLalamoveStatus, parseLalamoveWebhook,
} from "./lalamove.js";
import { haversineKm, mockCourierPrice } from "./mock-courier.js";
import { parseOpenDeliveryAvailability } from "./open-delivery.js";

// ── Lalamove ────────────────────────────────────────────────────────────────
test("lalamoveSignature: HMAC-SHA256 da string canônica", () => {
  const sig = lalamoveSignature({ secret: "sk_test", timestamp: "1700000000000", method: "POST", path: "/v3/quotations", body: '{"a":1}' });
  const expected = crypto.createHmac("sha256", "sk_test")
    .update("1700000000000\r\nPOST\r\n/v3/quotations\r\n\r\n{\"a\":1}").digest("hex");
  assert.equal(sig, expected);
  assert.equal(sig.length, 64); // hex de 32 bytes
});

test("lalamoveServiceType: moto→MOTORCYCLE, carro→SEDAN (default)", () => {
  assert.equal(lalamoveServiceType("moto"), "MOTORCYCLE");
  assert.equal(lalamoveServiceType("carro"), "SEDAN");
  assert.equal(lalamoveServiceType(undefined), "MOTORCYCLE");
});

test("buildLalamoveQuoteBody: stops com coordenadas (origem, destino)", () => {
  const body = buildLalamoveQuoteBody({
    pickup: { lat: -23.55, lng: -46.63, address: "Loja" },
    dropoff: { lat: -23.56, lng: -46.64, address: "Cliente" },
    modal: "moto",
  }) as any;
  assert.equal(body.data.serviceType, "MOTORCYCLE");
  assert.equal(body.data.stops.length, 2);
  assert.equal(body.data.stops[0].coordinates.lat, "-23.55");
  assert.equal(body.data.stops[1].address, "Cliente");
});

test("parseLalamoveQuote: extrai preço e distância (m→km)", () => {
  const q = parseLalamoveQuote({ data: { quotationId: "q1", priceBreakdown: { total: "14.90", currency: "BRL" }, distance: { value: "5200", unit: "m" } } }, "moto");
  assert.equal(q.provider, "lalamove");
  assert.equal(q.quotationId, "q1");
  assert.equal(q.priceBRL, 14.9);
  assert.equal(q.distanceKm, 5.2);
  assert.equal(q.modal, "moto");
});

test("buildLalamoveOrderBody: usa quotationId + stopIds da cotação", () => {
  const quote = { provider: "lalamove", quotationId: "q1", priceBRL: 14.9, modal: "moto" as const, raw: { data: { stops: [{ stopId: "s0" }, { stopId: "s1" }] } } };
  const body = buildLalamoveOrderBody({
    quote, pickup: { lat: 0, lng: 0 }, dropoff: { lat: 0, lng: 0 },
    sender: { name: "Loja", phone: "1190000" }, recipient: { name: "Ana", phone: "1199999" }, orderRef: "ord-1",
  }) as any;
  assert.equal(body.data.quotationId, "q1");
  assert.equal(body.data.sender.stopId, "s0");
  assert.equal(body.data.recipients[0].stopId, "s1");
  assert.equal(body.data.recipients[0].name, "Ana");
  assert.equal(body.data.metadata.orderRef, "ord-1");
});

test("normalizeLalamoveStatus: mapeia status do provider", () => {
  assert.equal(normalizeLalamoveStatus("ASSIGNING_DRIVER"), "pending");
  assert.equal(normalizeLalamoveStatus("PICKED_UP"), "picked_up");
  assert.equal(normalizeLalamoveStatus("COMPLETED"), "delivered");
  assert.equal(normalizeLalamoveStatus("CANCELED"), "canceled");
  assert.equal(normalizeLalamoveStatus("???"), "unknown");
});

test("parseLalamoveWebhook: extrai deliveryId + status (formato data.order)", () => {
  const r = parseLalamoveWebhook({ eventType: "ORDER_STATUS_CHANGED", data: { order: { orderId: "ord-99", status: "PICKED_UP" } } });
  assert.equal(r.deliveryId, "ord-99");
  assert.equal(r.status, "picked_up");
  assert.equal(r.rawStatus, "PICKED_UP");
});

test("parseLalamoveWebhook: formato plano (data.orderId) e status desconhecido", () => {
  const r = parseLalamoveWebhook({ data: { orderId: "ord-1", status: "WEIRD" } });
  assert.equal(r.deliveryId, "ord-1");
  assert.equal(r.status, "unknown");
});

// ── Mock courier (haversine + tarifa) ─────────────────────────────────────────
test("haversineKm: ~distância em linha reta", () => {
  // ~1.32 km entre dois pontos próximos em SP
  const km = haversineKm({ lat: -23.55, lng: -46.63 }, { lat: -23.56, lng: -46.64 });
  assert.ok(km > 1 && km < 2, `esperava ~1.3km, veio ${km}`);
});

test("mockCourierPrice: carro mais caro que moto", () => {
  assert.ok(mockCourierPrice(5, "carro") > mockCourierPrice(5, "moto"));
  assert.equal(mockCourierPrice(0, "moto"), 6);   // base moto
  assert.equal(mockCourierPrice(0, "carro"), 12); // base carro
});

// ── Open Delivery (parse tolerante) ───────────────────────────────────────────
test("parseOpenDeliveryAvailability: lê taxa e ETA tolerando variações de campo", () => {
  const q = parseOpenDeliveryAvailability({ deliveryFee: { value: 9.5 }, estimatedDeliveryTime: 30 }, "moto");
  assert.equal(q.provider, "opendelivery");
  assert.equal(q.priceBRL, 9.5);
  assert.equal(q.etaMinutes, 30);
});
