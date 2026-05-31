import { expect, type Page, type APIRequestContext } from "@playwright/test";
import { getPrisma } from "@hubadvisor/db";

// Helpers compartilhados dos testes E2E (ADR-038). Os specs rodam em Node, então
// podem semear dados direto via Prisma (igual aos testes de integração).

const prisma = getPrisma();

export async function tenantIdOf(slug: string): Promise<string> {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { slug }, select: { id: true } });
  return t.id;
}

/** Semeia um pedido (e o contato). status default "paid". */
export async function seedOrder(
  tenantId: string,
  opts: { status?: string; pendingApproval?: boolean; daysAgo?: number; contactName?: string; phone?: string } = {},
): Promise<{ orderId: string; contactId: string }> {
  const contact = await prisma.contact.create({
    data: { tenantId, name: opts.contactName ?? "Cliente E2E", phone: opts.phone },
  });
  const created = opts.daysAgo ? new Date(Date.now() - opts.daysAgo * 86_400_000) : new Date();
  const order = await prisma.order.create({
    data: {
      tenantId, contactId: contact.id,
      status: (opts.status ?? "paid") as any,
      subtotalBRL: 100, totalBRL: 100,
      paidAt: opts.status === "created" ? null : created,
      createdAt: created,
      metadata: (opts.pendingApproval ? { pendingApproval: true } : {}) as any,
    },
  });
  return { orderId: order.id, contactId: contact.id };
}

/** Cria uma loja nova (signup via API) e injeta o token no localStorage. Isolado. */
export async function loginFresh(page: Page, request: APIRequestContext): Promise<{ slug: string; token: string }> {
  const slug = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
  const res = await request.post("/api/auth/signup", {
    data: { storeName: "Loja E2E", slug, name: "QA", email: `qa@${slug}.com`, password: "senha123" },
  });
  expect(res.ok(), "signup deve retornar 2xx").toBeTruthy();
  const body = await res.json();
  await page.addInitScript((b) => {
    localStorage.setItem("hubadvisor_token", b.token);
    localStorage.setItem("hubadvisor_tenant", b.tenant);
    localStorage.setItem("hubadvisor_brand", "Loja E2E");
    localStorage.setItem("hubadvisor_role", b.role ?? "owner");
  }, { token: body.token, tenant: body.tenantSlug, role: body.user?.role });
  return { slug, token: body.token };
}

/** Coleta exceções de JS não tratadas (pageerror) — o sinal forte de bug. */
export function collectErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e.message)));
  return errs;
}
