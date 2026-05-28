import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionOrder, canTransitionReturn, canCancelOrder,
  canRequestReturn, businessDaysSince, returnDeadline,
} from "./order-state-machine.js";

test("transições de pedido válidas e inválidas", () => {
  assert.equal(canTransitionOrder("created", "paid"), true);
  assert.equal(canTransitionOrder("created", "canceled"), true);
  assert.equal(canTransitionOrder("paid", "picking"), true);
  assert.equal(canTransitionOrder("shipped", "delivered"), true);
  assert.equal(canTransitionOrder("delivered", "finalized"), true);
  // inválidas
  assert.equal(canTransitionOrder("created", "delivered"), false);
  assert.equal(canTransitionOrder("shipped", "canceled"), false); // postou → não cancela
  assert.equal(canTransitionOrder("finalized", "paid"), false);
  assert.equal(canTransitionOrder("canceled", "paid"), false);
});

test("transições de devolução", () => {
  assert.equal(canTransitionReturn("requested", "authorized"), true);
  assert.equal(canTransitionReturn("analyzing", "refunded"), true);
  assert.equal(canTransitionReturn("refunded", "analyzing"), false);
  assert.equal(canTransitionReturn("requested", "received"), false);
});

test("cancelamento livre só antes da postagem (CDC)", () => {
  assert.equal(canCancelOrder("created"), true);
  assert.equal(canCancelOrder("paid"), true);
  assert.equal(canCancelOrder("picking"), true);
  assert.equal(canCancelOrder("shipped"), false);
  assert.equal(canCancelOrder("delivered"), false);
});

test("devolução exige entrega + dentro do prazo", () => {
  const hoje = new Date();
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  const tresMesesAtras = new Date(hoje); tresMesesAtras.setMonth(hoje.getMonth() - 3);

  assert.equal(canRequestReturn("delivered", ontem), true, "entregue ontem → dentro do prazo");
  assert.equal(canRequestReturn("created", ontem), false, "não entregue → não devolve");
  assert.equal(canRequestReturn("delivered", null), false, "sem data de entrega → não devolve");
  assert.equal(canRequestReturn("delivered", tresMesesAtras), false, "fora do prazo de 7 dias úteis");
});

test("businessDaysSince exclui fins de semana", () => {
  // sexta → segunda = 1 dia útil (pula sáb/dom)
  const sexta = new Date("2026-05-22T12:00:00"); // 2026-05-22 é sexta
  const segunda = new Date("2026-05-25T12:00:00");
  assert.equal(businessDaysSince(sexta, segunda), 1);
  // mesma data → 0
  assert.equal(businessDaysSince(segunda, segunda), 0);
});

test("returnDeadline soma dias úteis", () => {
  const sexta = new Date("2026-05-22T12:00:00");
  const prazo = returnDeadline(sexta, 7);
  // 7 dias úteis a partir de sexta cai numa terça (2 fins de semana no meio)
  assert.equal(prazo.getDay() !== 0 && prazo.getDay() !== 6, true, "prazo cai em dia útil");
  assert.equal(prazo > sexta, true);
});
