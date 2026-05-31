import { getPrisma, withTenant } from "@hubadvisor/db";
import {
  DEFAULT_CLOTHING_PATTERN, buildCodeFromContext, decodeCode, type CodePattern,
} from "@hubadvisor/shared";
import { patternLabelsToZpl, patternLabelsToCsv, type PatternLabel } from "./label-service.js";
import { registerPieces } from "./piece-service.js";

// Geração de código pelo padrão da loja (ADR-035 fase 2). Preenche os campos
// automáticos (ano/mês, custo do produto, tamanho da variante, nº sequencial) e
// os manuais (fornecedor/tipo/margem), e produz as etiquetas (Code128 + QR).

const num = (d: { toString(): string } | number | null | undefined) => (d == null ? 0 : Number(d));

/** AAMM a partir de uma data. */
function yymmOf(d: Date): string {
  return String(d.getFullYear() % 100).padStart(2, "0") + String(d.getMonth() + 1).padStart(2, "0");
}

export function patternOf(tenant: { policies: unknown }): CodePattern {
  const p = (tenant.policies as Record<string, unknown> | null)?.["codePattern"] as CodePattern | undefined;
  return p?.segments?.length ? p : DEFAULT_CLOTHING_PATTERN;
}

type VariantInfo = { sku: string; size: string; productId: string; productName: string; costReais: number };

async function findVariant(tenantId: string, variantSku: string): Promise<VariantInfo | null> {
  const products = await getPrisma().product.findMany({
    where: { tenantId },
    select: { id: true, name: true, costBRL: true, variants: true },
  });
  for (const p of products) {
    const v = ((p.variants as Array<{ sku: string; size?: string }>) ?? []).find((x) => x.sku === variantSku);
    if (v) return { sku: variantSku, size: v.size ?? "", productId: p.id, productName: p.name, costReais: num(p.costBRL) };
  }
  return null;
}

/** Próximo nº sequencial SEM consumir (preview). */
async function peekSequence(tenantId: string): Promise<number> {
  const t = await getPrisma().tenant.findUnique({ where: { id: tenantId }, select: { policies: true } });
  return Number((t?.policies as Record<string, unknown>)?.codeSeq ?? 0) + 1;
}

/** Reserva `count` números sequenciais da loja (policies.codeSeq) e devolve o início. */
async function reserveSequence(tenantId: string, count: number): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { policies: true } });
    const policies = { ...((t?.policies as Record<string, unknown>) ?? {}) };
    const current = Number(policies.codeSeq ?? 0);
    policies.codeSeq = current + count;
    await tx.tenant.update({ where: { id: tenantId }, data: { policies: policies as any } });
    return current + 1; // primeiro número reservado
  });
}

export type GenerateInput = {
  variantSku: string;
  quantity?: number;
  manual?: Record<string, string>; // fornecedor/tipo/margem/custom (por key do segmento)
};

export type GeneratedCode = {
  code: string;
  decoded: Array<{ key: string; label: string; value: string }>;
  variantSku: string;
  size: string;
  description: string;
};

/**
 * Gera `quantity` códigos (um por peça, sequência incrementando) para a variante,
 * seguindo o padrão da loja. Cada peça recebe um número único.
 * `persist`=true (impressão) reserva os números e REGISTRA as peças no estoque;
 * false (preview) só espia o próximo número, sem consumir nem registrar.
 */
export async function generateCodes(tenantId: string, input: GenerateInput, opts: { persist?: boolean } = {}): Promise<GeneratedCode[]> {
  const qty = Math.max(1, Math.min(500, Math.floor(input.quantity ?? 1)));
  const tenant = await getPrisma().tenant.findUnique({ where: { id: tenantId }, select: { policies: true } });
  if (!tenant) throw new Error("tenant não encontrado");
  const pattern = patternOf(tenant);
  const v = await findVariant(tenantId, input.variantSku);
  if (!v) throw new Error("variante não encontrada no catálogo");

  const usesSequence = pattern.segments.some((s) => s.kind === "sequence");
  const start = usesSequence ? (opts.persist ? await reserveSequence(tenantId, qty) : await peekSequence(tenantId)) : 0;
  const yymm = yymmOf(new Date());

  const out: GeneratedCode[] = [];
  for (let i = 0; i < qty; i++) {
    const code = buildCodeFromContext(pattern, {
      yymm, costReais: v.costReais, sizeText: v.size, sequence: start + i, manual: input.manual,
    });
    out.push({ code, decoded: decodeCode(pattern, code), variantSku: v.sku, size: v.size, description: v.productName });
  }

  if (opts.persist) {
    await registerPieces(tenantId, out.map((c, i) => ({
      code: c.code, productId: v.productId, variantSku: v.sku, size: v.size,
      sequence: start + i, meta: input.manual ?? {},
    })));
  }
  return out;
}

/** Etiquetas (ZPL/CSV) a partir dos códigos gerados. */
export function codesToLabels(codes: GeneratedCode[], format: "zpl" | "csv"): string {
  const labels: PatternLabel[] = codes.map((c) => ({ code: c.code, description: c.description }));
  if (format === "csv") {
    return patternLabelsToCsv(codes.map((c) => ({ code: c.code, description: c.description, variantSku: c.variantSku, size: c.size })));
  }
  return patternLabelsToZpl(labels);
}
