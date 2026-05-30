import { getPrisma } from "@hubadvisor/db";

/* ============================================================================
   Storage de anexos da mercadológica (ADR-029).
   Por ora grava no Postgres (bytea) — funciona no deploy de serviço único do
   Railway sem object storage. A interface é a fronteira: para migrar a S3/R2,
   basta reimplementar storeAttachment/readAttachment (ex.: PUT/GET no bucket e
   guardar a key em vez dos bytes), sem tocar nos chamadores.
   ============================================================================ */

export async function storeAttachment(input: {
  tenantId: string;
  researchId?: string | null;
  fileName: string;
  mimeType: string;
  dataBase64: string;
}): Promise<{ id: string; sizeBytes: number }> {
  const buf = Buffer.from(input.dataBase64, "base64");
  const row = await getPrisma().researchAttachment.create({
    data: {
      tenantId: input.tenantId,
      researchId: input.researchId ?? null,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: buf.length,
      data: buf,
    },
    select: { id: true, sizeBytes: true },
  });
  return row;
}

export async function readAttachment(tenantId: string, id: string): Promise<
  { fileName: string; mimeType: string; data: Buffer } | null
> {
  const row = await getPrisma().researchAttachment.findFirst({
    where: { id, tenantId },
    select: { fileName: true, mimeType: true, data: true },
  });
  if (!row) return null;
  return { fileName: row.fileName, mimeType: row.mimeType, data: Buffer.from(row.data) };
}
