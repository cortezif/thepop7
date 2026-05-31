// Gera GIFs dos fluxos críticos do manual (docs/img/flow-*.gif).
// Rodar com tsx (resolve TS do @hubadvisor/db):  npx tsx scripts/gifs.mts
// Requer web (:3000) + api (:3001) no ar. Cada fluxo usa uma loja fresca e isolada.
import "dotenv/config";
import { chromium, type Page } from "@playwright/test";
import { getPrisma } from "@hubadvisor/db";
import { PNG } from "pngjs";
import gifencPkg from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifencPkg as any;
import { mkdir, writeFile } from "node:fs/promises";

const WEB = "http://localhost:3000";
const API = "http://localhost:3001";
const prisma = getPrisma();
const dir = "docs/img";
await mkdir(dir, { recursive: true });

const browser = await chromium.launch();

async function freshStore(storeName: string) {
  const slug = `gif-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
  const res = await fetch(`${API}/api/auth/signup`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storeName, slug, name: "Manual", email: `m@${slug}.com`, password: "senha123" }),
  });
  const body = await res.json();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 680 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((b: any) => {
    localStorage.setItem("hubadvisor_token", b.token);
    localStorage.setItem("hubadvisor_tenant", b.tenant);
    localStorage.setItem("hubadvisor_brand", b.brand);
    localStorage.setItem("hubadvisor_role", "owner");
  }, { token: body.token, tenant: body.tenantSlug, brand: storeName });
  const page = await ctx.newPage();
  return { page, ctx, slug: body.tenantSlug as string };
}

// ── codificação GIF ──────────────────────────────────────────────────────────
type Frame = { data: Uint8Array; width: number; height: number; delay: number };
async function shot(page: Page, delay: number): Promise<Frame> {
  const buf = await page.screenshot();
  const png = PNG.sync.read(buf as Buffer);
  return { data: png.data, width: png.width, height: png.height, delay };
}
async function encode(name: string, frames: Frame[]) {
  const gif = GIFEncoder();
  for (const f of frames) {
    const palette = quantize(f.data, 256);
    const index = applyPalette(f.data, palette);
    gif.writeFrame(index, f.width, f.height, { palette, delay: f.delay });
  }
  gif.finish();
  const out = `${dir}/${name}.gif`;
  await writeFile(out, Buffer.from(gif.bytes()));
  console.log("ok", out, `(${frames.length} frames)`);
}

// ── Fluxo 1: aprovar pedido pendente → gera PIX ──────────────────────────────
async function flowAprovar() {
  const { page, ctx, slug } = await freshStore("Boutique Aurora");
  const t = await prisma.tenant.findUniqueOrThrow({ where: { slug }, select: { id: true } });
  const contact = await prisma.contact.create({ data: { tenantId: t.id, name: "Marina Souza" } });
  await prisma.order.create({ data: {
    tenantId: t.id, contactId: contact.id, status: "created" as any,
    subtotalBRL: 320, totalBRL: 320, paidAt: null, metadata: { pendingApproval: true } as any,
  } });
  await page.goto(`${WEB}/pedidos`, { waitUntil: "networkidle" });
  await page.getByText("Aguardando aprovação").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const frames: Frame[] = [await shot(page, 1800)];
  await page.getByRole("button", { name: /Aprovar e gerar PIX/i }).first().click();
  await page.waitForTimeout(500);
  frames.push(await shot(page, 900));
  await page.waitForTimeout(1500);
  frames.push(await shot(page, 2200));
  await encode("flow-aprovar-pedido", frames);
  await ctx.close();
}

// ── Fluxo 2: montar etiqueta no seu padrão de código ─────────────────────────
async function flowEtiqueta() {
  const { page, ctx } = await freshStore("Boutique Aurora");
  await page.goto(`${WEB}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Usar sugest[aã]o de roupas/i }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const frames: Frame[] = [await shot(page, 1700)];
  await page.getByRole("button", { name: /Usar sugest[aã]o de roupas/i }).click();
  await page.getByText("26030104159030-0001-PP").scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  frames.push(await shot(page, 2400));
  await encode("flow-etiqueta-padrao", frames);
  await ctx.close();
}

// ── Fluxo 3: cadastrar fornecedor (rede de cotação) ──────────────────────────
async function flowFornecedor() {
  const { page, ctx } = await freshStore("Boutique Aurora");
  await page.goto(`${WEB}/mercadologica`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Fornecedores/i }).click();
  await page.getByRole("button", { name: /Novo fornecedor/i }).click();
  await page.waitForTimeout(500);
  const frames: Frame[] = [await shot(page, 1400)];
  await page.getByPlaceholder(/Nome \/ Raz[aã]o social/i).fill("Malharia Boa Vista Ltda");
  await page.waitForTimeout(300);
  frames.push(await shot(page, 1200));
  await page.getByRole("button", { name: /^Salvar$/i }).click();
  await page.getByText("Malharia Boa Vista Ltda").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  frames.push(await shot(page, 2200));
  await encode("flow-cotacao-fornecedor", frames);
  await ctx.close();
}

await flowAprovar();
await flowEtiqueta();
await flowFornecedor();
await browser.close();
console.log("done");
