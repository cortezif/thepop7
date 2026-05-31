import { test, expect } from "@playwright/test";
import { loginFresh, collectErrors, tenantIdOf, seedOrder } from "./fixtures";

// E2E dos fluxos de pedido/pós-venda/NPS/recompra (ADR-038). Loja nova por teste.

test("Satisfação: NPS detrator aparece com o comentário", async ({ page, request }) => {
  const errors = collectErrors(page);
  const { slug, token } = await loginFresh(page, request);
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // um detrator (com comentário) e um promotor
  const d = await request.post("/api/post-sale/nps", {
    headers: H, data: { tenantSlug: slug, score: 3, kind: "produto", comment: "Demorou demais pra entregar" },
  });
  expect(d.ok(), "registrar detrator deve dar 2xx").toBeTruthy();
  await request.post("/api/post-sale/nps", { headers: H, data: { tenantSlug: slug, score: 10, kind: "produto" } });

  await page.goto("/satisfacao");
  await expect(page.getByText("Demorou demais pra entregar")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Detrator", { exact: true }).first()).toBeVisible();
  expect(errors, errors.join(" | ")).toEqual([]);
});

test("Pedidos: aprovar um pedido pendente (gera PIX)", async ({ page, request }) => {
  const errors = collectErrors(page);
  const { slug } = await loginFresh(page, request);
  const tid = await tenantIdOf(slug);
  await seedOrder(tid, { status: "created", pendingApproval: true, contactName: "Cliente Pendente" });

  await page.goto("/pedidos");
  await expect(page.getByText("Aguardando aprovação")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /Aprovar e gerar PIX/i }).click();

  // após aprovar, some o botão de aprovação (mock de pagamento gera a cobrança)
  await expect(page.getByRole("button", { name: /Aprovar e gerar PIX/i })).toHaveCount(0, { timeout: 10_000 });
  expect(errors, errors.join(" | ")).toEqual([]);
});

test("Pedidos: simular entrega disponibiliza o pós-venda da Lia", async ({ page, request }) => {
  const errors = collectErrors(page);
  const { slug } = await loginFresh(page, request);
  const tid = await tenantIdOf(slug);
  // a loja nova já vem com pedidos de exemplo, então escopamos pelo card do nosso
  const { orderId } = await seedOrder(tid, { status: "paid", contactName: "Cliente Entrega E2E" });

  await page.goto("/pedidos");
  // o card do nosso pedido = o que tem o subtítulo #<id> e o botão de simular
  const card = page
    .locator("div")
    .filter({ has: page.getByText(`#${orderId.slice(-6)}`) })
    .filter({ has: page.getByRole("button", { name: /Simular entrega/i }) })
    .last();
  const lia = page.getByRole("button", { name: /Lia D14/i });
  const before = await lia.count();
  await card.getByRole("button", { name: /Simular entrega/i }).click();

  // pedido entregue → surge mais um conjunto de marcos da Lia (D+1/D+7/D+14/D+30).
  // (o disparo em si chama LLM; sem chave no CI ele falha — aqui validamos só a UI.)
  await expect(lia).toHaveCount(before + 1, { timeout: 15_000 });
  expect(errors, errors.join(" | ")).toEqual([]);
});

test("Recompra automática: 'Enviar agora' reativa um cliente inativo", async ({ page, request }) => {
  const errors = collectErrors(page);
  const { slug } = await loginFresh(page, request);
  const tid = await tenantIdOf(slug);
  // comprador inativo há 90 dias (com telefone, pra os conectores mock enviarem)
  await seedOrder(tid, { status: "paid", daysAgo: 90, contactName: "Cliente Sumido", phone: "+5511955554444" });

  await page.goto("/settings");
  // a janela de inatividade default pode ser > 90d; baixa pra 30 e garante o alcance
  await page.locator('label:has-text("Inativo há (dias)") input').fill("30");
  await page.getByRole("button", { name: /Enviar agora/i }).click();

  await expect(page.getByText(/Reativados [1-9]/)).toBeVisible({ timeout: 15_000 });
  expect(errors, errors.join(" | ")).toEqual([]);
});
