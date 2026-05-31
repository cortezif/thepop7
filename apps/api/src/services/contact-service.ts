import { getPrisma, withTenant, encryptPII, decryptPII, hashPII } from "@hubadvisor/db";
import { isCustomerTag, autoTags } from "@hubadvisor/shared";

// Cadastro de clientes / CRM (ADR-031). Lista contatos com agregados (saldo de
// cashback, nº de pedidos, total gasto, último pedido) e gere consentimento/opt-out
// (LGPD). PII fica cifrada — a view decifra e MASCARA para a lista.

const num = (d: { toString(): string } | number | null | undefined) => (d == null ? 0 : Number(d));
const r2 = (n: number) => Math.round(n * 100) / 100;

function maskPhone(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  return d.length >= 4 ? `••••${d.slice(-4)}` : "••••";
}
function maskEmail(e: string | null): string | null {
  if (!e) return null;
  const [u, dom] = e.split("@");
  if (!dom) return "•••";
  const head = (u ?? "").slice(0, 2);
  return `${head}•••@${dom}`;
}

export type ContactView = {
  id: string;
  name: string | null;
  phoneMasked: string | null;
  emailMasked: string | null;
  igHandle: string | null;
  channel: string | null; // canal de origem (whatsapp | instagram)
  city: string | null;
  state: string | null;
  hasAddress: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  consentLGPD: boolean;
  optOuts: string[];
  tags: string[];      // manuais (operador)
  autoTags: string[];  // automáticas (novo/frequente — derivadas dos pedidos)
  cashbackBRL: number;
  ordersCount: number;
  totalSpentBRL: number;
  lastOrderAt: Date | null;
  createdAt: Date;
};

export async function listContacts(
  tenantId: string,
  opts: { q?: string; optedOutMarketing?: boolean; withCashback?: boolean } = {},
): Promise<ContactView[]> {
  const prisma = getPrisma();
  const rows = await prisma.contact.findMany({
    where: { tenantId },
    select: {
      id: true, name: true, phone: true, email: true, igHandle: true,
      preferredChannel: true, consentLGPD: true, optOuts: true, tags: true, createdAt: true,
      city: true, state: true, cep: true, street: true,
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const ids = rows.map((c) => c.id);

  // Agregados de pedidos (contagem, total gasto, último) e saldo de cashback ativo.
  const [orderAgg, cbAgg] = await Promise.all([
    prisma.order.groupBy({
      by: ["contactId"],
      where: { tenantId, contactId: { in: ids } },
      _count: { _all: true },
      _sum: { totalBRL: true },
      _max: { createdAt: true },
    }),
    prisma.cashbackEntry.groupBy({
      by: ["contactId"],
      where: { tenantId, contactId: { in: ids }, kind: "accrual", remainingBRL: { gt: 0 }, expiresAt: { gt: new Date() } },
      _sum: { remainingBRL: true },
    }),
  ]);
  const orderBy = new Map(orderAgg.map((o) => [o.contactId, o]));
  const cbBy = new Map(cbAgg.map((c) => [c.contactId, c]));

  let view: ContactView[] = rows.map((c) => {
    const o = orderBy.get(c.id);
    return {
      id: c.id,
      name: c.name,
      phoneMasked: maskPhone(decryptPII(c.phone)),
      emailMasked: maskEmail(decryptPII(c.email)),
      igHandle: c.igHandle,
      channel: c.preferredChannel ?? (c.igHandle ? "instagram" : c.phone ? "whatsapp" : null),
      city: c.city,
      state: c.state,
      hasAddress: !!(c.cep || c.street || c.city),
      hasPhone: !!c.phone,
      hasEmail: !!c.email,
      consentLGPD: c.consentLGPD,
      optOuts: c.optOuts,
      tags: c.tags ?? [],
      autoTags: autoTags({ ordersCount: o?._count._all ?? 0 }),
      cashbackBRL: r2(num(cbBy.get(c.id)?._sum.remainingBRL)),
      ordersCount: o?._count._all ?? 0,
      totalSpentBRL: r2(num(o?._sum.totalBRL)),
      lastOrderAt: o?._max.createdAt ?? null,
      createdAt: c.createdAt,
    };
  });

  if (opts.optedOutMarketing) view = view.filter((c) => c.optOuts.includes("marketing"));
  if (opts.withCashback) view = view.filter((c) => c.cashbackBRL > 0);
  if (opts.q) {
    const q = opts.q.toLowerCase();
    view = view.filter((c) => (c.name ?? "").toLowerCase().includes(q) || (c.igHandle ?? "").toLowerCase().includes(q));
  }
  return view;
}

export async function contactStats(tenantId: string) {
  const list = await listContacts(tenantId);
  return {
    total: list.length,
    consented: list.filter((c) => c.consentLGPD).length,
    optedOutMarketing: list.filter((c) => c.optOuts.includes("marketing")).length,
    withCashback: list.filter((c) => c.cashbackBRL > 0).length,
    reachableWhatsapp: list.filter((c) => c.hasPhone && !c.optOuts.includes("marketing")).length,
    reachableEmail: list.filter((c) => c.hasEmail && !c.optOuts.includes("marketing")).length,
  };
}

// Campos de endereço estruturado do cliente (ADR-039). Texto puro.
export type ContactAddress = {
  cep?: string; street?: string; number?: string; complement?: string;
  district?: string; city?: string; state?: string;
};
export type ContactInput = ContactAddress & {
  name?: string; phone?: string; email?: string; igHandle?: string; cpf?: string; consentLGPD?: boolean;
};

const ADDR_KEYS = ["cep", "street", "number", "complement", "district", "city", "state"] as const;

/** Normaliza os campos de endereço (trim; UF em maiúsculas; vazio → null). */
function addressData(input: ContactAddress): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of ADDR_KEYS) {
    const v = (input as any)[k];
    if (v === undefined) continue;
    let s = typeof v === "string" ? v.trim() : "";
    if (k === "state") s = s.toUpperCase().slice(0, 2);
    if (k === "cep") s = s.replace(/\D/g, "").slice(0, 8);
    out[k] = s || null;
  }
  return out;
}

export async function createContactManual(tenantId: string, input: ContactInput) {
  const phone = input.phone?.trim() || undefined;
  const email = input.email?.trim() || undefined;
  const cpf = input.cpf?.replace(/\D/g, "").trim() || undefined;
  return withTenant(tenantId, async (tx) => {
    // Dedup por hash forte (não cria duplicado se já existe telefone/e-mail/CPF).
    const ors = [
      phone ? { phoneHash: hashPII(phone) } : null,
      email ? { emailHash: hashPII(email) } : null,
      cpf ? { cpfHash: hashPII(cpf) } : null,
      input.igHandle ? { igHandle: input.igHandle.trim() } : null,
    ].filter(Boolean) as any[];
    if (ors.length) {
      const dup = await tx.contact.findFirst({ where: { tenantId, OR: ors } });
      if (dup) return { id: dup.id, created: false as const };
    }
    const c = await tx.contact.create({
      data: {
        tenantId,
        name: input.name?.trim() || null,
        igHandle: input.igHandle?.trim() || null,
        phone: encryptPII(phone), phoneHash: hashPII(phone),
        email: encryptPII(email), emailHash: hashPII(email),
        cpf: encryptPII(cpf), cpfHash: hashPII(cpf),
        consentLGPD: !!input.consentLGPD,
        ...addressData(input),
      },
    });
    return { id: c.id, created: true as const };
  });
}

/** Cadastro completo (decifrado) de um contato — pré-preenche o editor. Owner. */
export async function getContactDetail(tenantId: string, id: string) {
  const c = await getPrisma().contact.findFirst({
    where: { id, tenantId },
    select: {
      id: true, name: true, phone: true, email: true, cpf: true, igHandle: true,
      cep: true, street: true, number: true, complement: true, district: true, city: true, state: true,
      consentLGPD: true,
    },
  });
  if (!c) return null;
  return {
    id: c.id, name: c.name,
    phone: decryptPII(c.phone), email: decryptPII(c.email), cpf: decryptPII(c.cpf),
    igHandle: c.igHandle,
    cep: c.cep, street: c.street, number: c.number, complement: c.complement,
    district: c.district, city: c.city, state: c.state,
    consentLGPD: c.consentLGPD,
  };
}

/** Edita o cadastro completo do cliente (re-cifra PII e recalcula os hashes). */
export async function updateContactProfile(tenantId: string, id: string, input: ContactInput) {
  return withTenant(tenantId, async (tx) => {
    const exists = await tx.contact.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!exists) throw new Error("contato não encontrado");
    const data: Record<string, unknown> = { ...addressData(input) };
    if (input.name !== undefined) data.name = input.name.trim() || null;
    if (input.igHandle !== undefined) data.igHandle = input.igHandle.trim() || null;
    if (typeof input.consentLGPD === "boolean") data.consentLGPD = input.consentLGPD;
    if (input.phone !== undefined) {
      const p = input.phone.trim() || undefined;
      data.phone = encryptPII(p); data.phoneHash = hashPII(p);
    }
    if (input.email !== undefined) {
      const e = input.email.trim() || undefined;
      data.email = encryptPII(e); data.emailHash = hashPII(e);
    }
    if (input.cpf !== undefined) {
      const cf = input.cpf.replace(/\D/g, "").trim() || undefined;
      data.cpf = encryptPII(cf); data.cpfHash = hashPII(cf);
    }
    await tx.contact.update({ where: { id }, data });
    return { ok: true };
  });
}

/** Atualiza consentimento e opt-outs (autosserviço do operador, LGPD). */
export async function updateContactConsent(
  tenantId: string,
  id: string,
  input: { consentLGPD?: boolean; optOuts?: string[] },
) {
  const data: { consentLGPD?: boolean; optOuts?: string[] } = {};
  if (typeof input.consentLGPD === "boolean") data.consentLGPD = input.consentLGPD;
  if (Array.isArray(input.optOuts)) data.optOuts = [...new Set(input.optOuts.filter((o) => typeof o === "string"))];
  return withTenant(tenantId, async (tx) => {
    const exists = await tx.contact.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!exists) throw new Error("contato não encontrado");
    await tx.contact.update({ where: { id }, data });
    return { ok: true };
  });
}

/** Define a classificação (perfil) do cliente — só tags do vocabulário (ADR-036). */
export async function updateContactTags(tenantId: string, id: string, tags: string[]) {
  const clean = [...new Set((tags ?? []).filter((t) => typeof t === "string" && isCustomerTag(t)))];
  return withTenant(tenantId, async (tx) => {
    const exists = await tx.contact.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!exists) throw new Error("contato não encontrado");
    await tx.contact.update({ where: { id }, data: { tags: clean } });
    return { ok: true, tags: clean };
  });
}
