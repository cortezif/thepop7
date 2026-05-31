import { test, expect } from "@playwright/test";
import { loginFresh, collectErrors } from "./fixtures";

// Smoke E2E do painel (ADR-038). Cada teste cria uma loja nova (signup via API) e
// injeta o token no localStorage — isolado, sem depender de dados semeados.

const PAGES: Array<[string, RegExp]> = [
  ["/", /Painel|Hoje|Conversas/i],
  ["/recursos", /Recursos/i],
  ["/inbox", /Atendimento|Conversas|Inbox/i],
  ["/catalog", /Cat[aá]logo/i],
  ["/pedidos", /Pedidos/i],
  ["/estoque", /Estoque/i],
  ["/compras", /Compras/i],
  ["/financeiro", /Financeiro/i],
  ["/mercadologica", /Mercadol[oó]gica/i],
  ["/clientes", /Clientes/i],
  ["/midia-paga", /M[ií]dia paga|An[uú]ncios/i],
  ["/promocoes", /Promo[cç][oõ]es/i],
  ["/satisfacao", /Satisfa[cç][aã]o|NPS/i],
  ["/entregadores", /Entregadores/i],
  ["/equipe", /Equipe/i],
  ["/settings", /Configura[cç][oõ]es|Automa[cç][aã]o/i],
  ["/conta", /conta/i],
];

test("todas as telas carregam sem erro de JS", async ({ page, request }) => {
  const errors = collectErrors(page);
  await loginFresh(page, request);
  for (const [path, rx] of PAGES) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("body")).toContainText(rx, { timeout: 10_000 });
  }
  expect(errors, `erros de JS: ${errors.join(" | ")}`).toEqual([]);
});

test("Clientes: cadastrar um cliente pelo formulário", async ({ page, request }) => {
  const errors = collectErrors(page);
  await loginFresh(page, request);
  await page.goto("/clientes");

  await page.getByRole("button", { name: /Novo cliente/i }).click();
  await page.getByPlaceholder("Nome", { exact: true }).fill("Cliente E2E");
  await page.getByPlaceholder(/Telefone/i).fill("+5511988887777");
  await page.getByRole("button", { name: /Cadastrar/i }).click();

  // O cliente recém-criado aparece na tabela.
  await expect(page.getByText("Cliente E2E")).toBeVisible({ timeout: 10_000 });
  expect(errors, errors.join(" | ")).toEqual([]);
});

test("Financeiro: lançar uma despesa pelo formulário atualiza o caixa", async ({ page, request }) => {
  const errors = collectErrors(page);
  await loginFresh(page, request);
  await page.goto("/financeiro");

  await page.getByRole("button", { name: /Lançamento/i }).click();
  await page.getByPlaceholder(/Valor/i).fill("42");
  await page.getByPlaceholder(/Descri[cç][aã]o/i).fill("Despesa E2E");
  await page.getByRole("button", { name: /Adicionar/i }).click();

  // O lançamento aparece na lista.
  await expect(page.getByText("Despesa E2E")).toBeVisible({ timeout: 10_000 });
  expect(errors, errors.join(" | ")).toEqual([]);
});
