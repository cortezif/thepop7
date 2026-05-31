import { test, expect } from "@playwright/test";
import { loginFresh, collectErrors } from "./fixtures";

// E2E dos fluxos construídos nesta sessão (ADR-038). Loja nova por teste (isolado).

test("Promoções: criar campanha (rascunho) pelo formulário", async ({ page, request }) => {
  const errors = collectErrors(page);
  await loginFresh(page, request);
  await page.goto("/promocoes");

  await page.getByRole("button", { name: "Nova campanha" }).click();
  await page.getByPlaceholder(/Cashback vencendo/i).fill("Campanha E2E");
  await page.getByPlaceholder(/cashback esperando/i).fill("Mensagem de teste E2E");
  // WhatsApp já vem selecionado; salva como rascunho (não envia).
  await page.getByRole("button", { name: /Salvar rascunho/i }).click();

  await expect(page.getByText("Campanha E2E")).toBeVisible({ timeout: 10_000 });
  expect(errors, errors.join(" | ")).toEqual([]);
});

test("Entregadores: cadastrar um entregador pelo formulário", async ({ page, request }) => {
  const errors = collectErrors(page);
  await loginFresh(page, request);
  await page.goto("/entregadores");

  await page.getByRole("button", { name: "Entregadores", exact: true }).click(); // aba
  await page.getByRole("button", { name: /Novo entregador/i }).click();
  await page.getByPlaceholder("Nome", { exact: true }).fill("João E2E");
  await page.getByRole("button", { name: /Cadastrar/i }).click();

  await expect(page.getByText("João E2E")).toBeVisible({ timeout: 10_000 });
  expect(errors, errors.join(" | ")).toEqual([]);
});

test("Configurações: padrão de código gera o exemplo de roupas", async ({ page, request }) => {
  const errors = collectErrors(page);
  await loginFresh(page, request);
  await page.goto("/settings");

  await page.getByRole("button", { name: /Usar sugestão de roupas/i }).click();
  await expect(page.getByText("26030104159030-0001-PP")).toBeVisible({ timeout: 10_000 });
  expect(errors, errors.join(" | ")).toEqual([]);
});

test("Clientes: marcar perfil (tag) de um cliente", async ({ page, request }) => {
  const errors = collectErrors(page);
  await loginFresh(page, request);
  await page.goto("/clientes");

  // cria um cliente
  await page.getByRole("button", { name: /Novo cliente/i }).click();
  await page.getByPlaceholder("Nome", { exact: true }).fill("Perfil E2E");
  await page.getByPlaceholder(/Telefone/i).fill("+5511977776666");
  await page.getByRole("button", { name: /Cadastrar/i }).click();
  await expect(page.getByText("Perfil E2E")).toBeVisible({ timeout: 10_000 });

  // abre o editor de perfil (⚙) e marca "Cliente frequente"
  await page.getByTitle("Perfil do cliente").first().click();
  await page.getByRole("button", { name: "Cliente frequente" }).click();
  await expect(page.getByRole("button", { name: "✓ Cliente frequente" })).toBeVisible({ timeout: 10_000 });
  expect(errors, errors.join(" | ")).toEqual([]);
});
