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

test("Estoque: gerar código de peça com o padrão da loja", async ({ page, request }) => {
  const errors = collectErrors(page);
  const { slug, token } = await loginFresh(page, request);
  // semeia um produto (a loja nova começa sem catálogo)
  const r = await request.post("/api/catalog/products", {
    headers: { Authorization: `Bearer ${token}` },
    data: { tenantSlug: slug, name: "Camiseta E2E", priceBRL: 50, costBRL: 30, variants: [{ sku: "CAM-M", size: "M", stock: 5 }] },
  });
  expect(r.ok(), "criar produto deve dar 2xx").toBeTruthy();

  await page.goto("/estoque");
  await page.getByRole("button", { name: /Pr[eé]-visualizar/i }).click();
  // um código no formato do padrão de roupas (…-NNNN-M) aparece
  await expect(page.getByText(/-\d{4}-M/).first()).toBeVisible({ timeout: 10_000 });
  expect(errors, errors.join(" | ")).toEqual([]);
});

test("Inbox: adicionar, fixar e apagar uma nota interna", async ({ page, request }) => {
  const errors = collectErrors(page);
  const { slug } = await loginFresh(page, request);
  // semeia uma conversa (endpoint público; a IA pode falhar sem chave, mas a
  // conversa+mensagem são persistidas antes do agente).
  const r = await request.post("/api/conversations/incoming", {
    data: { tenantSlug: slug, channel: "manual", contact: { phone: "+5511944443333" }, text: "oi, quero comprar" },
  });
  expect(r.ok(), "incoming deve dar 2xx").toBeTruthy();

  await page.goto("/inbox");
  await page.getByText(/5511944443333/).first().click();

  // adiciona
  await page.getByPlaceholder(/Anota[cç][aã]o interna/i).fill("Nota E2E");
  await page.getByRole("button", { name: /Anotar/i }).click();
  await expect(page.getByText("Nota E2E")).toBeVisible({ timeout: 10_000 });

  // fixa (o botão passa a "Desafixar")
  await page.getByTitle("Fixar no topo").first().click();
  await expect(page.getByTitle("Desafixar")).toBeVisible({ timeout: 10_000 });

  // apaga
  await page.getByTitle("Apagar nota").first().click();
  await expect(page.getByText("Nota E2E")).toHaveCount(0, { timeout: 10_000 });
  expect(errors, errors.join(" | ")).toEqual([]);
});

test("Estoque: registrar peças e dar baixa (venda) por código", async ({ page, request }) => {
  const errors = collectErrors(page);
  const { slug, token } = await loginFresh(page, request);
  const H = { Authorization: `Bearer ${token}` };
  await request.post("/api/catalog/products", {
    headers: H, data: { tenantSlug: slug, name: "Saia E2E", priceBRL: 80, costBRL: 40, variants: [{ sku: "SAIA-G", size: "G", stock: 3 }] },
  });
  // imprime 2 etiquetas (CSV) → registra 2 peças e devolve os códigos
  const csv = await (await request.post("/api/stock/pattern-labels?format=csv", {
    headers: H, data: { tenantSlug: slug, variantSku: "SAIA-G", quantity: 2 },
  })).text();
  const code = csv.split(/\r?\n/)[1].split(";")[0].replace(/^﻿/, "");
  expect(code, "código gerado").toMatch(/-\d{4}-G/);

  await page.goto("/estoque");
  await expect(page.getByText(/Estoque por tamanho/i)).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder(/c[oó]digo da pe[cç]a/i).fill(code);
  await page.getByRole("button", { name: /Dar baixa/i }).click();
  await expect(page.getByText(/Baixa OK/i)).toBeVisible({ timeout: 10_000 });
  expect(errors, errors.join(" | ")).toEqual([]);
});

test("Mercadológica: cadastrar um fornecedor", async ({ page, request }) => {
  const errors = collectErrors(page);
  await loginFresh(page, request);
  await page.goto("/mercadologica");
  await page.getByRole("button", { name: /Fornecedores/i }).click(); // aba
  await page.getByRole("button", { name: /Novo fornecedor/i }).click();
  await page.getByPlaceholder(/Nome \/ Raz[aã]o social/i).fill("Fornecedor E2E");
  await page.getByRole("button", { name: /^Salvar$/i }).click();
  await expect(page.getByText("Fornecedor E2E")).toBeVisible({ timeout: 10_000 });
  expect(errors, errors.join(" | ")).toEqual([]);
});

test("Clientes: marcar perfil (tag) de um cliente", async ({ page, request }) => {
  const errors = collectErrors(page);
  await loginFresh(page, request);
  await page.goto("/clientes");

  // cria um cliente
  await page.getByRole("button", { name: /Novo cliente/i }).click();
  await page.getByPlaceholder("Nome *", { exact: true }).fill("Perfil E2E");
  await page.getByPlaceholder(/Telefone/i).fill("+5511977776666");
  await page.getByRole("button", { name: /Cadastrar/i }).click();
  await expect(page.getByText("Perfil E2E")).toBeVisible({ timeout: 10_000 });

  // abre o editor de perfil (⚙) e marca "Cliente frequente"
  await page.getByTitle("Perfil do cliente").first().click();
  await page.getByRole("button", { name: "Cliente frequente" }).click();
  await expect(page.getByRole("button", { name: "✓ Cliente frequente" })).toBeVisible({ timeout: 10_000 });
  expect(errors, errors.join(" | ")).toEqual([]);
});
