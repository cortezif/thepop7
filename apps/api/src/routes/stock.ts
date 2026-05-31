import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { listMovements, traceByBarcode, movementByBarcode } from "../services/stock-movement-service.js";
import { resolveScannedBarcode } from "../services/barcode-service.js";
import { buildLabelItems, labelsToCsv, labelsToZpl } from "../services/label-service.js";
import { generateCodes, codesToLabels } from "../services/code-gen-service.js";
import { pieceSummary, sellPiece, findPiece } from "../services/piece-service.js";
import { getPrisma } from "@hubadvisor/db";
import { normalizeBarcode } from "@hubadvisor/shared";

export const stockRoutes: FastifyPluginAsync = async (app) => {
  // GET /stock/movements?barcode=&productId=&variantSku= — razão (mais recentes)
  app.get("/movements", async (req) => {
    const q = req.query as any;
    return listMovements(req.auth!.tenantId, {
      barcode: q.barcode ? normalizeBarcode(q.barcode) : undefined,
      productId: q.productId || undefined,
      variantSku: q.variantSku || undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  });

  // GET /stock/trace?barcode=... — rastreabilidade: produto+variante, histórico, saldo
  app.get("/trace", async (req, reply) => {
    const code = normalizeBarcode(String((req.query as any).code ?? (req.query as any).barcode ?? ""));
    if (!code) return reply.code(400).send({ error: "informe ?code=<barcode>" });
    const hit = await resolveScannedBarcode(req.auth!.tenantId, code);
    if (!hit) return reply.code(404).send({ error: "código não encontrado" });
    const trace = await traceByBarcode(req.auth!.tenantId, code);
    return { ...hit, ...trace };
  });

  // POST /stock/labels?format=csv|zpl — arquivo único de etiquetas pro fornecedor.
  // Body: { items: [{variantSku, quantity}] }. Sem items → todas as variantes do catálogo (qtd 1).
  app.post("/labels", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string().optional(),
      items: z.array(z.object({ variantSku: z.string(), quantity: z.number().int().positive() })).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const format = String((req.query as any).format ?? "csv").toLowerCase();
    const tenantId = req.auth!.tenantId;

    let requested = body.data.items ?? [];
    if (requested.length === 0) {
      // default: todas as variantes do catálogo, 1 etiqueta cada
      const products = await getPrisma().product.findMany({ where: { tenantId }, select: { variants: true } });
      requested = products.flatMap((p) => ((p.variants as Array<{ sku: string }>) ?? []).map((v) => ({ variantSku: v.sku, quantity: 1 })));
    }

    const { items, missing } = await buildLabelItems(tenantId, requested);
    if (format === "zpl") {
      reply.header("content-type", "text/plain; charset=utf-8")
           .header("content-disposition", `attachment; filename="etiquetas.zpl"`)
           .header("x-labels-missing", String(missing.length));
      return labelsToZpl(items);
    }
    reply.header("content-type", "text/csv; charset=utf-8")
         .header("content-disposition", `attachment; filename="etiquetas.csv"`)
         .header("x-labels-missing", String(missing.length));
    return labelsToCsv(items);
  });

  // ── Código próprio da loja (ADR-035 fase 2) ─────────────────────────────────
  const genBody = z.object({
    tenantSlug: z.string().optional(),
    variantSku: z.string(),
    quantity: z.number().int().positive().max(500).optional(),
    manual: z.record(z.string(), z.string()).optional(),
  });

  // POST /stock/generate-codes — PREVIEW (não consome nº nem registra peças).
  app.post("/generate-codes", async (req, reply) => {
    const body = genBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      return await generateCodes(req.auth!.tenantId, body.data, { persist: false });
    } catch (e: any) { return reply.code(400).send({ error: e?.message ?? "falha" }); }
  });

  // POST /stock/pattern-labels?format=zpl|csv — gera, REGISTRA as peças e baixa
  // as etiquetas (Code128 + QR). Aqui os números são consumidos de verdade.
  app.post("/pattern-labels", async (req, reply) => {
    const body = genBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const format = String((req.query as any).format ?? "zpl").toLowerCase() === "csv" ? "csv" : "zpl";
    try {
      const codes = await generateCodes(req.auth!.tenantId, body.data, { persist: true });
      const file = codesToLabels(codes, format);
      reply.header("content-type", format === "csv" ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8")
           .header("content-disposition", `attachment; filename="codigos.${format}"`);
      return file;
    } catch (e: any) { return reply.code(400).send({ error: e?.message ?? "falha" }); }
  });

  // GET /stock/pieces/summary — estoque de peças por tamanho (ADR-035 fase 3).
  app.get("/pieces/summary", async (req) => pieceSummary(req.auth!.tenantId));

  // POST /stock/pieces/sell { code } — dá baixa numa peça (venda) por scan.
  app.post("/pieces/sell", async (req, reply) => {
    const code = String((req.body as any)?.code ?? "").trim();
    if (!code) return reply.code(400).send({ error: "informe o código da peça" });
    try {
      const r = await sellPiece(req.auth!.tenantId, code);
      return { ok: true, alreadySold: r.alreadySold, piece: { code: r.piece.code, variantSku: r.piece.variantSku, size: r.piece.size, status: r.piece.status } };
    } catch (e: any) { return reply.code(404).send({ error: e?.message ?? "peça não encontrada" }); }
  });

  // GET /stock/pieces/find?code= — consulta uma peça (scan).
  app.get("/pieces/find", async (req, reply) => {
    const code = String((req.query as any)?.code ?? "").trim();
    if (!code) return reply.code(400).send({ error: "informe ?code=" });
    const p = await findPiece(req.auth!.tenantId, code);
    if (!p) return reply.code(404).send({ error: "peça não encontrada" });
    return { code: p.code, variantSku: p.variantSku, size: p.size, status: p.status, sequence: p.sequence };
  });

  // POST /stock/receive — recebimento de mercadoria (purchase_in) por scan.
  app.post("/receive", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      barcode: z.string(),
      quantity: z.number().int().positive(),
      note: z.string().optional(),
      purchaseRequestId: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      return await movementByBarcode(req.auth!.tenantId, {
        barcode: normalizeBarcode(body.data.barcode), type: "purchase_in",
        quantity: body.data.quantity, note: body.data.note,
        refType: body.data.purchaseRequestId ? "purchase_request" : "manual",
        refId: body.data.purchaseRequestId,
      });
    } catch (e: any) { return reply.code(404).send({ error: e?.message ?? String(e) }); }
  });

  // POST /stock/adjust — ajuste manual (balanço/perda) por scan → adjust_in | adjust_out
  app.post("/adjust", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      barcode: z.string(),
      type: z.enum(["adjust_in", "adjust_out"]),
      quantity: z.number().int().positive(),
      note: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      return await movementByBarcode(req.auth!.tenantId, {
        barcode: normalizeBarcode(body.data.barcode), type: body.data.type,
        quantity: body.data.quantity, note: body.data.note, refType: "manual",
      });
    } catch (e: any) { return reply.code(404).send({ error: e?.message ?? String(e) }); }
  });
};
