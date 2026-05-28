import { test } from "node:test";
import assert from "node:assert/strict";
import { detectHallucination } from "./hallucination.js";

test("preço sem tool → flag", () => {
  const r = detectHallucination("Esse vestido custa R$ 199,90, lindo!", []);
  assert.equal(r.flagged, true);
  assert.match(r.reasons[0]!, /valor/);
});

test("preço COM busca → ok", () => {
  const r = detectHallucination("Achei! Custa R$ 199,90.", ["buscar_produto"]);
  assert.equal(r.flagged, false);
});

test("total do pedido após criar_pedido → ok", () => {
  const r = detectHallucination("Pedido criado! Total R$ 313,90, segue o PIX.", ["criar_pedido"]);
  assert.equal(r.flagged, false);
});

test("disponibilidade sem verificar → flag", () => {
  const r = detectHallucination("Sim, temos em estoque! Pode comprar tranquila.", []);
  assert.equal(r.flagged, true);
  assert.match(r.reasons.join(" "), /disponibilidade|estoque/);
});

test("disponibilidade com verificar_estoque → ok", () => {
  const r = detectHallucination("Tem em estoque sim!", ["verificar_estoque"]);
  assert.equal(r.flagged, false);
});

test("resposta sem fatos sensíveis → ok", () => {
  const r = detectHallucination("Oi! Me conta pra qual ocasião você procura?", []);
  assert.equal(r.flagged, false);
});

test("dois problemas → dois motivos", () => {
  const r = detectHallucination("Custa R$ 89 e temos em estoque!", []);
  assert.equal(r.flagged, true);
  assert.equal(r.reasons.length, 2);
});
