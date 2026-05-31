// Prints adicionais do manual (partes sem imagem). SHOT_TOKEN=... node scripts/shots-extra.mjs
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const TOKEN = process.env.SHOT_TOKEN;
const SHOTS = [
  ["/equipe",  "13-equipe"],
  ["/insumos", "12-fabricacao"],
];
await mkdir("docs/img", { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript((t) => {
  localStorage.setItem("hubadvisor_token", t);
  localStorage.setItem("hubadvisor_tenant", "thepop7");
  localStorage.setItem("hubadvisor_brand", "The Pop 7");
  localStorage.setItem("hubadvisor_role", "owner");
}, TOKEN);
const p = await ctx.newPage();
for (const [route, name] of SHOTS) {
  await p.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `docs/img/${name}.png` });
  console.log("ok", `docs/img/${name}.png`);
}
await b.close();
