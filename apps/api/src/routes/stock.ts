import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { listMovements, traceByBarcode, recordMovement } from "../services/stock-movement-service.js";
import { resolveScannedBarcode } from "../services/barcode-service.js";
import { buildLabelItems, labelsToCsv, labelsToZpl } from "../services/label-service.js";
import { getPrisma } from "@thepop/db";
import { normalizeBarcode } from "@thepop/shared";

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

  // POST /stock/adjust — ajuste manual (balanço/perda) → adjust_in | adjust_out
  app.post("/adjust", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(),
      productId: z.string(),
      variantSku: z.string(),
      type: z.enum(["adjust_in", "adjust_out"]),
      quantity: z.number().int().positive(),
      note: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const m = await recordMovement(req.auth!.tenantId, {
      productId: body.data.productId, variantSku: body.data.variantSku,
      type: body.data.type, quantity: body.data.quantity, note: body.data.note,
      refType: "manual", actor: "operator",
    });
    return { ok: true, id: m.id };
  });
};
