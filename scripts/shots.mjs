// Gera os prints do manual (docs/img/*.png) reaproveitando a sessão de dev.
// Uso: node scripts/shots.mjs   (web em :3000 e api em :3001 precisam estar no ar)
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const TOKEN = process.env.SHOT_TOKEN;
const TENANT = process.env.SHOT_TENANT ?? "thepop7";
const BRAND = process.env.SHOT_BRAND ?? "The Pop 7";
if (!TOKEN) { console.error("defina SHOT_TOKEN"); process.exit(1); }

const SHOTS = [
  ["/settings",      "01-configuracoes"],
  ["/inbox",         "05-inbox"],
  ["/catalog",       "03-catalogo"],
  ["/estoque",       "03-estoque"],
  ["/pedidos",       "04-pedidos"],
  ["/promocoes",     "06-promocoes"],
  ["/satisfacao",    "07-satisfacao"],
  ["/clientes",      "08-clientes"],
  ["/mercadologica", "09-mercadologica"],
  ["/financeiro",    "10-financeiro"],
];

const dir = "docs/img";
await mkdir(dir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();

// injeta a sessão antes de qualquer script da app rodar
await page.addInitScript(({ token, tenant, brand }) => {
  localStorage.setItem("hubadvisor_token", token);
  localStorage.setItem("hubadvisor_tenant", tenant);
  localStorage.setItem("hubadvisor_brand", brand);
  localStorage.setItem("hubadvisor_role", "owner");
}, { token: TOKEN, tenant: TENANT, brand: BRAND });

for (const [route, name] of SHOTS) {
  await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200); // deixa cards/gráficos assentarem
  const out = `${dir}/${name}.png`;
  await page.screenshot({ path: out }); // só a dobra (viewport) — uniforme p/ o manual
  console.log("ok", out);
}

await browser.close();
console.log("done");
