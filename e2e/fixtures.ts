import { expect, type Page, type APIRequestContext } from "@playwright/test";

// Helpers compartilhados dos testes E2E (ADR-038).

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
