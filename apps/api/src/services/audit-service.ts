import { createHash } from "node:crypto";
import { getPrisma, withTenant } from "@thepop/db";

/**
 * Audit log append-only com hash encadeado (ADR-013).
 * Padrão portado de adviser-editor/backend (HashChainService).
 *
 * hash_n = SHA-256(hash_{n-1} + seq + action + canonical(payload))
 * Adulterar qualquer registro quebra a cadeia a partir dele.
 */

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
}

function computeHash(prevHash: string, seq: number, action: string, payload: unknown): string {
  return createHash("sha256")
    .update(`${prevHash}|${seq}|${action}|${canonical(payload)}`)
    .digest("hex");
}

export type AuditInput = {
  action: string;
  entityType?: string;
  entityId?: string;
  actor?: string;
  payload?: Record<string, unknown>;
};

/** Anexa um registro de auditoria encadeado. Transação curta. */
export async function appendAudit(tenantId: string, input: AuditInput) {
  return withTenant(tenantId, async (tx) => {
    const last = await tx.auditLog.findFirst({
      where: { tenantId },
      orderBy: { seq: "desc" },
      select: { seq: true, hash: true },
    });
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? "";
    const payload = input.payload ?? {};
    const hash = computeHash(prevHash, seq, input.action, payload);

    const row = await tx.auditLog.create({
      data: {
        tenantId, seq, action: input.action,
        entityType: input.entityType, entityId: input.entityId,
        actor: input.actor ?? "system",
        payload: payload as any, prevHash, hash,
      },
    });
    return { seq: row.seq, hash: row.hash };
  });
}

/** Verifica a integridade da cadeia inteira do tenant. */
export async function verifyAuditChain(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const logs = await tx.auditLog.findMany({ where: { tenantId }, orderBy: { seq: "asc" } });
    let prevHash = "";
    for (const log of logs) {
      const expected = computeHash(prevHash, log.seq, log.action, log.payload);
      if (log.prevHash !== prevHash) {
        return { valid: false, brokenAtSeq: log.seq, reason: "prevHash não bate" };
      }
      if (log.hash !== expected) {
        return { valid: false, brokenAtSeq: log.seq, reason: "hash recomputado diverge (registro adulterado)" };
      }
      prevHash = log.hash;
    }
    return { valid: true, entries: logs.length };
  });
}
