import { test } from "node:test";
import assert from "node:assert/strict";
import { buildZenviaBody } from "./zenvia.js";

test("buildZenviaBody: from/to/contents text", () => {
  const b = buildZenviaBody("ThePop7", "5583999990000", "Promo!") as any;
  assert.equal(b.from, "ThePop7");
  assert.equal(b.to, "5583999990000");
  assert.deepEqual(b.contents, [{ type: "text", text: "Promo!" }]);
});
