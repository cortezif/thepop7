import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { withTestTenant } from "./helpers.js";
import {
  createSupplier, addSupplierOffer, createResearch, addInvites, sendInvites,
  submitPublicQuote, listPendingQuotes, approveQuote, recordPriceQuote,
  consolidateResearch, processResends, mercadologicaPanel,
} from "../services/mercadologica-service.js";

const prisma = getPrisma();

test("Mercadológica E2E: pesquisa → convites → cotações → aprovação → mapa comparativo (ADR-029)", async () => {
  await withTestTenant(async (tenantId) => {
    // 1. Fornecedores + tabela de preços
    const s1 = await createSupplier(tenantId, { name: "Fornecedor A", phone: "+5511900000001", uf: "SP" });
    const s2 = await createSupplier(tenantId, { name: "Fornecedor B", phone: "+5511900000002", uf: "GO" });
    const off = await addSupplierOffer(tenantId, { supplierId: s1.id, item: "Cabide cx100", priceBRL: 78 });
    assert.ok(off.ok, "oferta criada");

    // 2. Pesquisa com 1 item
    const research = await createResearch(tenantId, {
      title: "Reposição teste", items: [{ description: "Cabide cx100", quantity: 5 }],
      method: "mediana", deadlineDays: 5,
    });
    assert.ok(research.id);

    // 3. Convites (1 cadastrado + 1 avulso) → tokens
    const inv = await addInvites(tenantId, research.id, [
      { supplierId: s1.id, supplierName: "Fornecedor A", phone: "+5511900000001" },
      { supplierName: "Fornecedor C (avulso)", phone: "+5511900000003" },
    ]);
    assert.ok(inv.ok && inv.invites!.length === 2, "2 convites com token");
    const tokens = inv.invites!.map((i) => i.token);

    // 4. Envio (sem credencial WA/e-mail → mock; sempre devolve links)
    const sent = await sendInvites(tenantId, research.id);
    assert.ok(sent.ok && sent.links!.length === 2, "envio gera 2 links");

    // 5. Respostas públicas (formulário) → cotações PENDENTES
    await submitPublicQuote(tokens[0]!, { item: "Cabide cx100", unitPriceBRL: 78.0 });
    await submitPublicQuote(tokens[1]!, { item: "Cabide cx100", unitPriceBRL: 84.0 });
    const pending = await listPendingQuotes(tenantId);
    assert.equal(pending.length, 2, "2 cotações aguardando aprovação");

    // 6. Aprova as duas
    for (const q of pending) {
      const r = await approveQuote(tenantId, q.id);
      assert.ok(r.ok, "aprovada");
    }

    // 7. Cotação manual (já aprovada) entra no comparativo
    await recordPriceQuote(tenantId, { researchId: research.id, supplierName: "Fornecedor B", supplierId: s2.id, item: "Cabide cx100", unitPriceBRL: 81.5 });

    // 8. Consolidação / mapa comparativo
    const cons = await consolidateResearch(tenantId, research.id);
    assert.ok(cons, "consolidação retornou");
    const item = cons!.items.find((i) => i.item === "Cabide cx100")!;
    assert.equal(item.quotes.length, 3, "3 preços no comparativo");
    assert.equal(item.consolidation.min, 78.0, "menor preço = 78");
    assert.equal(item.consolidation.median, 81.5, "mediana de [78, 81.5, 84] = 81.5");
    assert.equal(item.consolidation.estimate, 81.5, "estimativa pela mediana");
    assert.equal(item.consolidation.meetsMinimumThree, true, "≥ 3 preços");
    const cheapest = item.quotes.find((q) => q.isCheapest)!;
    assert.equal(cheapest.unitPriceBRL, 78.0, "vencedor é o de 78");

    // 9. Painel agrega
    const panel = await mercadologicaPanel(tenantId);
    assert.equal(panel.suppliers, 2, "2 fornecedores no painel");
    assert.equal(panel.pendingQuotes, 0, "nada pendente após aprovação");
  });
});

test("Mercadológica: reenvio automático após o prazo (ADR-029)", async () => {
  await withTestTenant(async (tenantId) => {
    const research = await createResearch(tenantId, {
      title: "Reenvio teste", items: [{ description: "Item X" }], deadlineDays: 1,
    });
    const inv = await addInvites(tenantId, research.id, [{ supplierName: "Fornecedor lento", phone: "+5511911111111" }]);
    await sendInvites(tenantId, research.id); // marca enviado, sentAt = agora

    // Força o convite a "vencer": sentAt 3 dias atrás
    await prisma.priceResearchInvite.updateMany({
      where: { researchId: research.id },
      data: { sentAt: new Date(Date.now() - 3 * 86_400_000) },
    });

    const r = await processResends();
    assert.ok(r.resent >= 1, "ao menos 1 convite reenviado");

    const after = await prisma.priceResearchInvite.findFirst({ where: { researchId: research.id } });
    assert.equal(after!.state, "reenviado", "estado vira reenviado");
    assert.ok(after!.attempts >= 2, "tentativas incrementadas");
  });
});
