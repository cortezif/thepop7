import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { withTestTenant } from "./helpers.js";
import { cashflow, createEntry, listEntries, deleteEntry, monthKey, openAccounts, payEntry, cashflowCsv } from "../services/finance-service.js";

// Fluxo de caixa (ADR-032): vendas (pedidos pagos) + lançamentos manuais. test:integration.

const prisma = getPrisma();

test("cashflow: soma vendas pagas do mês + receitas/despesas manuais", async () => {
  await withTestTenant(async (tenantId) => {
    const contact = await prisma.contact.create({ data: { tenantId, name: "Ana" } });
    const now = new Date();
    const month = monthKey(now);

    // Pedido pago neste mês (entra como venda) + um criado mas não pago (não entra).
    await prisma.order.create({ data: { tenantId, contactId: contact.id, status: "paid", subtotalBRL: 200, totalBRL: 200, paidAt: now } });
    await prisma.order.create({ data: { tenantId, contactId: contact.id, status: "created", subtotalBRL: 99, totalBRL: 99 } });
    // Pedido pago no mês PASSADO (fora do período).
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    await prisma.order.create({ data: { tenantId, contactId: contact.id, status: "paid", subtotalBRL: 500, totalBRL: 500, paidAt: lastMonth } });

    // Lançamentos manuais do mês.
    await createEntry(tenantId, { type: "despesa", category: "aluguel", amountBRL: 80 });
    await createEntry(tenantId, { type: "despesa", category: "fornecedor", amountBRL: 50 });
    const extra = await createEntry(tenantId, { type: "receita", category: "outro", amountBRL: 30 });

    const cf = await cashflow(tenantId, month);
    assert.equal(cf.vendasBRL, 200, "só o pedido pago do mês");
    assert.equal(cf.ordersCount, 1);
    assert.equal(cf.receitasManuaisBRL, 30);
    assert.equal(cf.receitasBRL, 230, "200 vendas + 30 manual");
    assert.equal(cf.despesasBRL, 130);
    assert.equal(cf.saldoBRL, 100, "230 − 130");
    assert.equal(cf.byCategory.length, 3);

    const entries = await listEntries(tenantId, month);
    assert.equal(entries.length, 3);

    // Remoção.
    await deleteEntry(tenantId, extra.id);
    const cf2 = await cashflow(tenantId, month);
    assert.equal(cf2.receitasManuaisBRL, 0);
    assert.equal(cf2.saldoBRL, 70, "200 − 130");

    await prisma.financialEntry.deleteMany({ where: { tenantId } });
  });
});

test("contas a pagar: pendente não entra no caixa; baixar move pro realizado", async () => {
  await withTestTenant(async (tenantId) => {
    const month = monthKey(new Date());
    const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    // Conta a pagar pendente, vencida ontem.
    const conta = await createEntry(tenantId, { type: "despesa", category: "fornecedor", amountBRL: 300, status: "pendente", dueDate: ontem });

    // Não conta no caixa realizado; aparece como a pagar/vencida.
    const cf = await cashflow(tenantId, month);
    assert.equal(cf.despesasBRL, 0, "pendente não entra no caixa");
    assert.equal(cf.aPagarBRL, 300);
    assert.equal(cf.vencidasBRL, 300, "vencida ontem");
    assert.equal((await listEntries(tenantId, month)).length, 0, "lista do mês só mostra pagos");

    const open = await openAccounts(tenantId);
    assert.equal(open.length, 1);
    assert.equal(open[0]!.overdue, true);

    // Baixa → vira despesa realizada hoje.
    await payEntry(tenantId, conta.id);
    const cf2 = await cashflow(tenantId, month);
    assert.equal(cf2.despesasBRL, 300, "após baixar, entra no caixa");
    assert.equal(cf2.aPagarBRL, 0);
    assert.equal((await openAccounts(tenantId)).length, 0, "não está mais em aberto");

    // CSV do mês inclui o lançamento pago.
    const csv = await cashflowCsv(tenantId, month);
    assert.match(csv, /data,tipo,categoria,descricao,valor/);
    assert.match(csv, /despesa,fornecedor,.*,300\.00/);

    await prisma.financialEntry.deleteMany({ where: { tenantId } });
  });
});
