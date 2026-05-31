import { getPrisma, withTenant, encryptPII, decryptPII, hashPII } from "@hubadvisor/db";
import { isCustomerTag } from "@hubadvisor/shared";

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
  hasPhone: boolean;
  hasEmail: boolean;
  consentLGPD: boolean;
  optOuts: string[];
  tags: string[];
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
      hasPhone: !!c.phone,
      hasEmail: !!c.email,
      consentLGPD: c.consentLGPD,
      optOuts: c.optOuts,
      tags: c.tags ?? [],
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

export async function createContactManual(
  tenantId: string,
  input: { name?: string; phone?: string; email?: string; igHandle?: string; consentLGPD?: boolean },
) {
  const phone = input.phone?.trim() || undefined;
  const email = input.email?.trim() || undefined;
  return withTenant(tenantId, async (tx) => {
    // Dedup por hash forte (não cria duplicado se já existe telefone/e-mail).
    const ors = [
      phone ? { phoneHash: hashPII(phone) } : null,
      email ? { emailHash: hashPII(email) } : null,
      input.igHandle ? { igHandle: input.igHandle } : null,
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
        consentLGPD: !!input.consentLGPD,
      },
    });
    return { id: c.id, created: true as const };
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
