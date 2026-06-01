import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WA_SERVICE_WINDOW_MS,
  waWindowOpen,
  waWindowExpiresAt,
  classifyOutbound,
  waCostBRL,
  waPriceTableBRL,
} from "./whatsapp-pricing.js";

test("waWindowOpen: dentro de 24h abre, fora fecha", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  assert.equal(waWindowOpen(new Date(now.getTime() - 1000), now), true); // 1s atrás
  assert.equal(waWindowOpen(new Date(now.getTime() - 23 * 3600_000), now), true);
  assert.equal(waWindowOpen(new Date(now.getTime() - 24 * 3600_000), now), false); // exatamente 24h
  assert.equal(waWindowOpen(new Date(now.getTime() - 25 * 3600_000), now), false);
});

test("waWindowOpen: sem inbound ou data inválida → fechada", () => {
  assert.equal(waWindowOpen(null), false);
  assert.equal(waWindowOpen(undefined), false);
  assert.equal(waWindowOpen("não é data"), false);
});

test("waWindowOpen: aceita string ISO", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  assert.equal(waWindowOpen("2026-06-01T11:00:00Z", now), true);
  assert.equal(waWindowOpen("2026-05-30T11:00:00Z", now), false);
});

test("waWindowExpiresAt: inbound + 24h, ou null", () => {
  const t = new Date("2026-06-01T12:00:00Z");
  assert.equal(waWindowExpiresAt(t)!.getTime(), t.getTime() + WA_SERVICE_WINDOW_MS);
  assert.equal(waWindowExpiresAt(null), null);
});

test("classifyOutbound: janela aberta sempre service (grátis)", () => {
  assert.equal(classifyOutbound({ windowOpen: true }), "service");
  assert.equal(classifyOutbound({ windowOpen: true, intent: "marketing" }), "service");
});

test("classifyOutbound: janela fechada cai na intent (default utility)", () => {
  assert.equal(classifyOutbound({ windowOpen: false }), "utility");
  assert.equal(classifyOutbound({ windowOpen: false, intent: "marketing" }), "marketing");
  assert.equal(classifyOutbound({ windowOpen: false, intent: "authentication" }), "authentication");
});

test("waCostBRL: service é grátis; pagas são positivas e ordenadas", () => {
  assert.equal(waCostBRL("service"), 0);
  const t = waPriceTableBRL();
  assert.ok(t.utility > 0);
  assert.ok(t.marketing > 0);
  // utility deve ser a categoria paga mais barata (premissa de otimização).
  assert.ok(t.utility <= t.marketing);
});

test("waPriceTableBRL: respeita override por env", () => {
  const prev = process.env.WA_PRICE_MARKETING_BRL;
  process.env.WA_PRICE_MARKETING_BRL = "0.99";
  assert.equal(waCostBRL("marketing"), 0.99);
  if (prev === undefined) delete process.env.WA_PRICE_MARKETING_BRL;
  else process.env.WA_PRICE_MARKETING_BRL = prev;
});
