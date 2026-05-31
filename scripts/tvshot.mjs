// Print do Painel de TV pro manual. SHOT_TOKEN=... node scripts/tvshot.mjs
import { chromium } from "@playwright/test";
const TOKEN = process.env.SHOT_TOKEN;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript((t) => {
  localStorage.setItem("hubadvisor_token", t);
  localStorage.setItem("hubadvisor_tenant", "thepop7");
  localStorage.setItem("hubadvisor_brand", "The Pop 7");
  localStorage.setItem("hubadvisor_role", "owner");
}, TOKEN);
const p = await ctx.newPage();
await p.goto("http://localhost:3000/tv", { waitUntil: "networkidle" });
await p.waitForTimeout(2000);
await p.screenshot({ path: "docs/img/11-painel-tv.png" });
console.log("ok docs/img/11-painel-tv.png");
await b.close();
