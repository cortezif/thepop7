import crypto from "node:crypto";
import { getPrisma, withTenant, resolveTenantCredentials } from "@hubadvisor/db";
import { getMessagingConnector } from "@hubadvisor/connectors";
import { enterCredentials } from "@hubadvisor/shared";
import { createEntry } from "./finance-service.js";

// Entregadores próprios + corridas (ADR-033). Cadastro da loja, atribuição de
// pedidos e ciclo de status. O entregador acessa as próprias corridas por token.

const num = (d: { toString(): string } | number | null | undefined) => (d == null ? 0 : Number(d));

export const JOB_STATUSES = ["pendente", "atribuido", "aceito", "coletado", "entregue", "cancelado"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// Transições válidas do ciclo de entrega. cancelado é possível de qualquer estado
// não-final. Pura (testável).
const NEXT: Record<JobStatus, JobStatus[]> = {
  pendente: ["atribuido", "cancelado"],
  atribuido: ["aceito", "cancelado"],
  aceito: ["coletado", "cancelado"],
  coletado: ["entregue", "cancelado"],
  entregue: [],
  cancelado: [],
};

export function canTransition(from: string, to: string): boolean {
  return (NEXT[from as JobStatus] ?? []).includes(to as JobStatus);
}

/** Quem pode acionar a transição: o entregador só avança aceito→coletado→entregue. */
export function courierMayTransition(to: string): boolean {
  return ["aceito", "coletado", "entregue"].includes(to);
}

const TIMESTAMP_FIELD: Partial<Record<JobStatus, string>> = {
  atribuido: "assignedAt", aceito: "acceptedAt", coletado: "pickedUpAt", entregue: "deliveredAt",
};

function courierAppLink(token: string): string {
  const base = (process.env.APP_PUBLIC_URL ?? "").replace(/\/$/, "");
  return `${base}/entregador/${token}`;
}

/** Avisa o entregador (WhatsApp) sobre uma nova corrida atribuída. Não-fatal. */
async function notifyCourierAssigned(tenantId: string, courier: { id: string; name: string; phone: string | null; accessToken: string }, job: { address: string | null; feeBRL: { toString(): string } | number | null }) {
  if (!courier.phone) return;
  try {
    enterCredentials(await resolveTenantCredentials(tenantId));
    const fee = job.feeBRL != null ? ` Você recebe R$ ${Number(job.feeBRL).toFixed(2)}.` : "";
    const text = `🛵 Nova entrega pra você, ${courier.name.split(" ")[0]}!\n📍 ${job.address ?? "endereço com a loja"}.${fee}\nAcompanhe e confirme aqui: ${courierAppLink(courier.accessToken)}`;
    await getMessagingConnector("whatsapp").send({ tenantId, conversationId: `courier-${courier.id}`, type: "text", text, to: courier.phone, channel: "whatsapp" });
  } catch { /* não-fatal */ }
}

/** Lança o pagamento do entregador como despesa (conta paga) no Financeiro. Não-fatal. */
async function recordCourierFee(tenantId: string, job: { id: string; feeBRL: { toString(): string } | number | null; courierId: string | null }) {
  if (job.feeBRL == null) return;
  const fee = Number(job.feeBRL);
  if (!(fee > 0)) return;
  try {
    let courierName = "";
    if (job.courierId) {
      const c = await getPrisma().courier.findUnique({ where: { id: job.courierId }, select: { name: true } });
      courierName = c?.name ?? "";
    }
    await createEntry(tenantId, { type: "despesa", category: "entregador", amountBRL: fee, description: courierName || undefined });
  } catch { /* não-fatal */ }
}

// ── Entregadores (roster) ────────────────────────────────────────────────────
export async function listCouriers(tenantId: string) {
  return getPrisma().courier.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
}

export async function createCourier(tenantId: string, input: { name: string; phone?: string; vehicle?: string }) {
  const vehicle = ["moto", "carro", "bike", "a_pe"].includes(input.vehicle ?? "") ? input.vehicle! : "moto";
  return withTenant(tenantId, (tx) =>
    tx.courier.create({
      data: { tenantId, name: input.name.trim(), phone: input.phone?.trim() || null, vehicle, accessToken: crypto.randomBytes(16).toString("hex") },
    }),
  );
}

export async function updateCourier(tenantId: string, id: string, input: { name?: string; phone?: string | null; vehicle?: string; active?: boolean }) {
  return withTenant(tenantId, async (tx) => {
    const c = await tx.courier.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!c) throw new Error("entregador não encontrado");
    const data: Record<string, unknown> = {};
    if (input.name != null) data.name = input.name.trim();
    if (input.phone !== undefined) data.phone = input.phone?.trim() || null;
    if (input.vehicle && ["moto", "carro", "bike", "a_pe"].includes(input.vehicle)) data.vehicle = input.vehicle;
    if (typeof input.active === "boolean") data.active = input.active;
    await tx.courier.update({ where: { id }, data });
    return { ok: true as const };
  });
}

// ── Corridas (jobs) ──────────────────────────────────────────────────────────
function addressOf(order: { shippingAddress: unknown; shippingZip: string | null }): string | null {
  const a = order.shippingAddress as Record<string, unknown> | null;
  if (a && typeof a === "object") {
    const parts = [a.street, a.number, a.neighborhood, a.city, a.state].filter(Boolean);
    if (parts.length) return parts.join(", ");
  }
  return order.shippingZip ?? null;
}

export async function createJobForOrder(tenantId: string, orderId: string, input: { feeBRL?: number; courierId?: string; notes?: string } = {}) {
  const job = await withTenant(tenantId, async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, tenantId }, select: { id: true, shippingAddress: true, shippingZip: true } });
    if (!order) throw new Error("pedido não encontrado");
    const existing = await tx.deliveryJob.findFirst({ where: { tenantId, orderId, status: { not: "cancelado" } } });
    if (existing) throw new Error("este pedido já tem uma corrida ativa");
    let courierId: string | null = null;
    if (input.courierId) {
      const c = await tx.courier.findFirst({ where: { id: input.courierId, tenantId, active: true }, select: { id: true } });
      if (!c) throw new Error("entregador inválido");
      courierId = c.id;
    }
    return tx.deliveryJob.create({
      data: {
        tenantId, orderId,
        courierId,
        status: courierId ? "atribuido" : "pendente",
        assignedAt: courierId ? new Date() : null,
        feeBRL: input.feeBRL != null ? Math.abs(input.feeBRL) : null,
        address: addressOf(order),
        notes: input.notes?.trim() || null,
      },
    });
  });
  if (job.courierId) {
    const c = await getPrisma().courier.findUnique({ where: { id: job.courierId }, select: { id: true, name: true, phone: true, accessToken: true } });
    if (c) await notifyCourierAssigned(tenantId, c, job);
  }
  return job;
}

export async function assignJob(tenantId: string, jobId: string, courierId: string) {
  const job = await withTenant(tenantId, async (tx) => {
    const j = await tx.deliveryJob.findFirst({ where: { id: jobId, tenantId } });
    if (!j) throw new Error("corrida não encontrada");
    if (!canTransition(j.status, "atribuido") && j.status !== "pendente") throw new Error(`não dá para atribuir uma corrida ${j.status}`);
    const c = await tx.courier.findFirst({ where: { id: courierId, tenantId, active: true }, select: { id: true } });
    if (!c) throw new Error("entregador inválido");
    return tx.deliveryJob.update({ where: { id: jobId }, data: { courierId, status: "atribuido", assignedAt: new Date() } });
  });
  const c = await getPrisma().courier.findUnique({ where: { id: courierId }, select: { id: true, name: true, phone: true, accessToken: true } });
  if (c) await notifyCourierAssigned(tenantId, c, job);
  return job;
}

export async function transitionJob(tenantId: string, jobId: string, to: JobStatus) {
  const job = await withTenant(tenantId, async (tx) => {
    const j = await tx.deliveryJob.findFirst({ where: { id: jobId, tenantId } });
    if (!j) throw new Error("corrida não encontrada");
    if (!canTransition(j.status, to)) throw new Error(`transição inválida: ${j.status} → ${to}`);
    const data: Record<string, unknown> = { status: to };
    const ts = TIMESTAMP_FIELD[to];
    if (ts) data[ts] = new Date();
    const updated = await tx.deliveryJob.update({ where: { id: jobId }, data });
    if (to === "entregue") {
      await tx.order.updateMany({ where: { id: j.orderId, tenantId }, data: { status: "delivered", deliveredAt: new Date() } });
    }
    return updated;
  });
  if (to === "entregue") await recordCourierFee(tenantId, job);
  return job;
}

export async function listJobs(tenantId: string, status?: string) {
  const jobs = await getPrisma().deliveryJob.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { courier: { select: { name: true, vehicle: true } } },
  });
  return jobs.map((j) => ({ ...j, feeBRL: j.feeBRL != null ? num(j.feeBRL) : null }));
}

// ── App do entregador (acesso por token, sem auth) ───────────────────────────
export async function courierByToken(token: string) {
  return getPrisma().courier.findUnique({ where: { accessToken: token } });
}

export async function courierJobs(courierId: string) {
  const jobs = await getPrisma().deliveryJob.findMany({
    where: { courierId, status: { in: ["atribuido", "aceito", "coletado"] } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return jobs.map((j) => ({ ...j, feeBRL: j.feeBRL != null ? num(j.feeBRL) : null }));
}

/** Transição acionada pelo PRÓPRIO entregador (via token). Valida posse + papel. */
export async function courierTransition(token: string, jobId: string, to: JobStatus) {
  const courier = await courierByToken(token);
  if (!courier || !courier.active) throw new Error("acesso inválido");
  if (!courierMayTransition(to)) throw new Error("ação não permitida ao entregador");
  const job = await withTenant(courier.tenantId, async (tx) => {
    const j = await tx.deliveryJob.findFirst({ where: { id: jobId, tenantId: courier.tenantId, courierId: courier.id } });
    if (!j) throw new Error("corrida não encontrada");
    if (!canTransition(j.status, to)) throw new Error(`transição inválida: ${j.status} → ${to}`);
    const data: Record<string, unknown> = { status: to };
    const ts = TIMESTAMP_FIELD[to];
    if (ts) data[ts] = new Date();
    const updated = await tx.deliveryJob.update({ where: { id: jobId }, data });
    if (to === "entregue") {
      await tx.order.updateMany({ where: { id: j.orderId, tenantId: courier.tenantId }, data: { status: "delivered", deliveredAt: new Date() } });
    }
    return updated;
  });
  if (to === "entregue") await recordCourierFee(courier.tenantId, job);
  return job;
}
