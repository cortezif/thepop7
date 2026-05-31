import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, courierMayTransition } from "./courier-service.js";

test("canTransition: ciclo válido pendente→…→entregue", () => {
  assert.ok(canTransition("pendente", "atribuido"));
  assert.ok(canTransition("atribuido", "aceito"));
  assert.ok(canTransition("aceito", "coletado"));
  assert.ok(canTransition("coletado", "entregue"));
});

test("canTransition: rejeita pulos e estados finais", () => {
  assert.ok(!canTransition("pendente", "entregue"), "não pula direto");
  assert.ok(!canTransition("atribuido", "coletado"), "tem que aceitar antes");
  assert.ok(!canTransition("entregue", "coletado"), "final não volta");
  assert.ok(!canTransition("cancelado", "aceito"));
});

test("canTransition: cancelar é possível de qualquer ativo", () => {
  assert.ok(canTransition("pendente", "cancelado"));
  assert.ok(canTransition("aceito", "cancelado"));
  assert.ok(!canTransition("entregue", "cancelado"));
});

test("courierMayTransition: entregador só avança aceito/coletado/entregue", () => {
  assert.ok(courierMayTransition("aceito"));
  assert.ok(courierMayTransition("entregue"));
  assert.ok(!courierMayTransition("atribuido"), "quem atribui é a loja");
  assert.ok(!courierMayTransition("cancelado"));
});
