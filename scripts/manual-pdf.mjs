// Gera docs/manual-operacao.pdf a partir do manual em Markdown (com imagens).
// Uso: node scripts/manual-pdf.mjs   (offline; não precisa de servidor)
// marked roda via npx (sem instalar no projeto); Playwright renderiza o PDF.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const MD = "docs/manual-operacao.md";
const HTML = "docs/_manual.html";
const PDF = "docs/manual-operacao.pdf";

// 1) Markdown → HTML (GFM: tabelas + task-lists). marked via npx, em cache global.
let body = execSync(`npx -y marked --gfm -i ${MD}`, { encoding: "utf8", maxBuffer: 1e8 });

// Quebra de página antes de cada "Parte N" (cada parte começa numa página nova).
body = body.replace(/<h2([^>]*)>Parte /g, '<h2$1 class="part">Parte ');

const CSS = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2330; max-width: 100%; }
  h1 { font-size: 26pt; color: #b11e54; margin: 0 0 4pt; }
  h2 { font-size: 16pt; color: #b11e54; border-bottom: 1px solid #eadfe4; padding-bottom: 3pt; margin: 18pt 0 8pt; }
  h2.part { page-break-before: always; }
  h3 { font-size: 12.5pt; color: #2a2f3d; margin: 12pt 0 4pt; }
  p, li { margin: 4pt 0; }
  a { color: #b11e54; text-decoration: none; }
  code { background: #f3eef1; padding: 1px 4px; border-radius: 3px; font-size: 9.5pt; font-family: "Consolas", monospace; }
  blockquote { margin: 6pt 0; padding: 4pt 12pt; border-left: 3px solid #e4b9cc; background: #faf5f7; color: #50525e; border-radius: 0 4px 4px 0; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9.5pt; page-break-inside: avoid; }
  th, td { border: 1px solid #e6dde2; padding: 4pt 7pt; text-align: left; vertical-align: top; }
  th { background: #f7eef2; color: #7a2247; }
  tr:nth-child(even) td { background: #fcfafb; }
  img { max-width: 100%; height: auto; border: 1px solid #ece4e8; border-radius: 6px; margin: 6pt 0; page-break-inside: avoid; }
  hr { border: none; border-top: 1px solid #eee; margin: 14pt 0; }
  ul { padding-left: 18pt; }
  li { page-break-inside: avoid; }
  /* Caixas "🖱️ Passo a passo" (tutorial click-a-clique) */
  .howto { border: 1px solid #e4b9cc; border-radius: 8px; margin: 8pt 0 12pt; overflow: hidden; page-break-inside: avoid; }
  .howto-bar { background: #b11e54; color: #fff; font-weight: 700; font-size: 10pt; padding: 5pt 12pt; }
  .howto ol { margin: 8pt 0; padding-left: 30pt; }
  .howto li { margin: 4pt 0; }
  .howto li b { color: #7a2247; }
`;

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`;
writeFileSync(HTML, html);

// 2) HTML → PDF (Playwright). O HTML fica em docs/ para os ./img/* resolverem.
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(pathToFileURL(resolve(HTML)).href, { waitUntil: "networkidle" });
await page.pdf({
  path: PDF, format: "A4", printBackground: true,
  margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: '<div style="width:100%;font-size:8pt;color:#999;text-align:center;padding:0 12mm;">Manual de Operação — Hub Advisor · pág. <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
});
await browser.close();
rmSync(HTML, { force: true });
console.log("ok", PDF);
