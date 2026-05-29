import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcilePicking, type PickingExpected } from "./picking-service.js";

const expected: PickingExpected[] = [
  { variantSku: "VF-M-AZ", barcode: "2000000000015", quantity: 2 },
  { variantSku: "BOLSA-1", barcode: "2000000000022", quantity: 1 },
];

test("reconcilePicking: tudo bipado certo → complete", () => {
  const r = reconcilePicking(expected, ["2000000000015", "2000000000015", "2000000000022"]);
  assert.equal(r.complete, true);
  assert.deepEqual(r.items.map((i) => i.missing), [0, 0]);
  assert.equal(r.extras.length, 0);
});

test("reconcilePicking: faltando uma unidade → incompleto, missing aponta", () => {
  const r = reconcilePicking(expected, ["2000000000015", "2000000000022"]);
  assert.equal(r.complete, false);
  const vf = r.items.find((i) => i.variantSku === "VF-M-AZ")!;
  assert.equal(vf.conferred, 1);
  assert.equal(vf.missing, 1);
});

test("reconcilePicking: código fora do pedido vira extra", () => {
  const r = reconcilePicking(expected, ["2000000000015", "2000000000015", "2000000000022", "7898357410016"]);
  assert.equal(r.complete, false); // tem extra
  assert.deepEqual(r.extras, [{ barcode: "7898357410016", count: 1 }]);
});

test("reconcilePicking: excesso do mesmo código também é extra", () => {
  const r = reconcilePicking(expected, ["2000000000015", "2000000000015", "2000000000015", "2000000000022"]);
  assert.equal(r.extras.find((e) => e.barcode === "2000000000015")?.count, 1); // bipou 3, esperado 2
});
