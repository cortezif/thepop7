import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { withTestTenant } from "./helpers.js";
import { generateCodes } from "../services/code-gen-service.js";
import { pieceSummary, sellPiece } from "../services/piece-service.js";

// Peças serializadas (ADR-035 fase 3): impressão registra cada peça; conta por
// tamanho e dá baixa na venda. test:integration (Postgres).

const prisma = getPrisma();

async function seedProduct(tenantId: string) {
  return prisma.product.create({
    data: {
      tenantId, externalId: "BL-X", name: "Blusa X", priceBRL: 120, costBRL: 75,
      variants: [{ sku: "BL-X-PP", size: "PP", stock: 0 }, { sku: "BL-X-M", size: "M", stock: 0 }] as any,
      media: {} as any, styles: [], occasions: [], enrichmentStatus: "approved", active: true,
    },
  });
}

test("peças: preview não registra; impressão registra e conta por tamanho; venda dá baixa", async () => {
  await withTestTenant(async (tenantId) => {
    await seedProduct(tenantId);

    // Preview (persist:false) → nada registrado, número não consumido.
    const prev = await generateCodes(tenantId, { variantSku: "BL-X-PP", quantity: 2, manual: { fornecedor: "01", tipo: "04", margem: "030" } }, { persist: false });
    assert.equal(prev.length, 2);
    assert.equal((await pieceSummary(tenantId)).emEstoque, 0, "preview não registra");

    // Impressão (persist:true) → 3 peças PP + 2 peças M.
    const pp = await generateCodes(tenantId, { variantSku: "BL-X-PP", quantity: 3, manual: { fornecedor: "01", tipo: "04", margem: "030" } }, { persist: true });
    await generateCodes(tenantId, { variantSku: "BL-X-M", quantity: 2, manual: { fornecedor: "01", tipo: "04", margem: "030" } }, { persist: true });

    const sum = await pieceSummary(tenantId);
    assert.equal(sum.emEstoque, 5, "3 PP + 2 M");
    assert.equal(sum.bySize.find((s) => s.size === "PP")!.count, 3);
    assert.equal(sum.bySize.find((s) => s.size === "M")!.count, 2);

    // Sequência incrementou entre os lotes (PP 0001-0003, M 0004-0005).
    assert.match(pp[0]!.code, /-0001-PP$/);
    assert.match(pp[2]!.code, /-0003-PP$/);

    // Venda dá baixa: PP cai pra 2; vendidas = 1.
    const sold = await sellPiece(tenantId, pp[0]!.code);
    assert.equal(sold.alreadySold, false);
    const sum2 = await pieceSummary(tenantId);
    assert.equal(sum2.emEstoque, 4);
    assert.equal(sum2.vendidas, 1);
    assert.equal(sum2.bySize.find((s) => s.size === "PP")!.count, 2);

    // Vender de novo a mesma peça é idempotente.
    const again = await sellPiece(tenantId, pp[0]!.code);
    assert.equal(again.alreadySold, true);
    assert.equal((await pieceSummary(tenantId)).vendidas, 1);

    await prisma.piece.deleteMany({ where: { tenantId } });
  });
});
