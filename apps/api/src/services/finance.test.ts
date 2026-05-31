import { test } from "node:test";
import assert from "node:assert/strict";
import { monthRange, monthKey, summarizeEntries } from "./finance-service.js";

test("monthRange: parse e limites do mês", () => {
  const r = monthRange("2026-02")!;
  assert.equal(r.start.getFullYear(), 2026);
  assert.equal(r.start.getMonth(), 1); // fevereiro
  assert.equal(r.end.getMonth(), 2);   // março (exclusivo)
  assert.equal(monthRange("2026-13"), null);
  assert.equal(monthRange("xx"), null);
});

test("monthKey: formata YYYY-MM", () => {
  assert.equal(monthKey(new Date(2026, 0, 15)), "2026-01");
  assert.equal(monthKey(new Date(2026, 11, 1)), "2026-12");
});

test("summarizeEntries: separa receita/despesa e agrupa por categoria", () => {
  const s = summarizeEntries([
    { type: "despesa", category: "aluguel", amountBRL: 1000 },
    { type: "despesa", category: "fornecedor", amountBRL: 500 },
    { type: "despesa", category: "fornecedor", amountBRL: 250 },
    { type: "receita", category: "outro", amountBRL: 80 },
  ]);
  assert.equal(s.despesasBRL, 1750);
  assert.equal(s.receitasManuaisBRL, 80);
  // ordenado por total desc: fornecedor 750, aluguel 1000? → 1000 > 750
  assert.equal(s.byCategory[0]!.category, "aluguel");
  const forn = s.byCategory.find((c) => c.category === "fornecedor")!;
  assert.equal(forn.totalBRL, 750);
  assert.equal(forn.type, "despesa");
});
