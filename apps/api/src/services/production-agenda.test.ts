import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDueDate } from "./production-service.js";

test("computeDueDate: data do pedido + prazo (dias)", () => {
  assert.equal(computeDueDate("2026-05-30T10:00:00.000Z", 2), "2026-06-01");
  assert.equal(computeDueDate("2026-05-30T10:00:00.000Z", 0), "2026-05-30");
  assert.equal(computeDueDate("2026-05-30T10:00:00.000Z", null), "2026-05-30"); // sem prazo → mesma data
  assert.equal(computeDueDate(new Date("2026-12-31T12:00:00.000Z"), 1), "2027-01-01"); // vira o ano
});
