import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrisma } from "@hubadvisor/db";
import { withTestTenant } from "./helpers.js";
import { recordNps, pendingDetractorComment, attachNpsComment, npsComments } from "../services/nps.js";

// Recuperação de detrator (ADR-017): captura o comentário na mensagem seguinte
// à nota baixa e o expõe no painel. test:integration (Postgres).

const prisma = getPrisma();

test("NPS detrator: pendente captura comentário e some após preencher", async () => {
  await withTestTenant(async (tenantId) => {
    const c = await prisma.contact.create({ data: { tenantId, name: "Ana" } });
    const promotor = await prisma.contact.create({ data: { tenantId, name: "Bia" } });

    await recordNps(tenantId, { contactId: c.id, kind: "produto", score: 3 });
    await recordNps(tenantId, { contactId: promotor.id, kind: "produto", score: 10 });

    // Só o detrator sem comentário fica pendente.
    const pending = await pendingDetractorComment(tenantId, c.id);
    assert.ok(pending, "detrator pendente encontrado");
    assert.equal(await pendingDetractorComment(tenantId, promotor.id), null, "promotor não é pendente");

    await attachNpsComment(tenantId, pending!.id, "Demorou pra entregar e veio sem a sacola.");
    assert.equal(await pendingDetractorComment(tenantId, c.id), null, "após comentar, não fica mais pendente");

    const comments = await npsComments(tenantId);
    assert.equal(comments.length, 1);
    assert.equal(comments[0]!.band, "detrator");
    assert.match(comments[0]!.comment, /sacola/);
  });
});
