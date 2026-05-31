// Edição de IMPRESSÃO (gráfica) do manual → docs/manual-operacao-impressao.pdf
// Capa + colofão + sumário paginado (Paged.js) + aberturas de capítulo +
// cabeçalho/rodapé corridos + sangria 3mm + marcas de corte (A4).
// Uso: node scripts/manual-print.mjs   (offline; usa scripts/paged.polyfill.js)
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const MD = "docs/manual-operacao.md";
const HTML = "docs/_print.html";
const PDF = "docs/manual-operacao-impressao.pdf";

const slug = (t) => t.toLowerCase().replace(/<[^>]+>/g, "").replace(/[()]/g, "")
  .replace(/[^\wáàâãéêíóôõúüç\s-]/g, "").trim().replace(/\s+/g, "-");

// 1) Markdown → HTML
let body = execSync(`npx -y marked --gfm -i ${MD}`, { encoding: "utf8", maxBuffer: 1e8 });

// Mantém de "Legenda de status" em diante (capa/colofão substituem título+intro+índice).
const start = body.search(/<h2[^>]*>Legenda/);
if (start > 0) body = body.slice(start);

// Aberturas de capítulo: classe + id nas "Parte N".
body = body.replace(/<h2[^>]*>Parte (\d+)([\s\S]*?)<\/h2>/g,
  (m, n, rest) => `<h2 class="part" id="part-${n}">Parte ${n}${rest}</h2>`);
// ids explícitos nas seções referenciadas pelo sumário (evita slugs frágeis).
const SECID = [
  [/<h2([^>]*)>Legenda de status<\/h2>/, "sec-legenda"],
  [/<h2([^>]*)>Painel de integrações[\s\S]*?<\/h2>/, "sec-integracoes"],
  [/<h2([^>]*)>Mapa completo[\s\S]*?<\/h2>/, "sec-mapa"],
  [/<h2([^>]*)>Glossário<\/h2>/, "sec-glossario"],
  [/<h2([^>]*)>Papéis e permissões<\/h2>/, "sec-papeis"],
  [/<h2([^>]*)>Perguntas frequentes[\s\S]*?<\/h2>/, "sec-faq"],
];
for (const [re, id] of SECID) body = body.replace(re, (m) => m.replace(/^<h2/, `<h2 id="${id}"`));
// id genérico nas demais h2 que sobraram (não atrapalha o sumário).
body = body.replace(/<h2(?![^>]*id=)([^>]*)>([\s\S]*?)<\/h2>/g,
  (m, attrs, txt) => `<h2${attrs} id="${slug(txt)}">${txt}</h2>`);

// 2) Sumário (Paged.js preenche os números de página via target-counter).
const PARTS = [
  "Fundação", "Canais de conversa", "Catálogo & estoque", "Pagamento & entrega",
  "Atendimento & pedidos", "Fidelidade & marketing", "Pós-venda & satisfação",
  "Clientes & perfis", "Compras & mercadológica", "Financeiro", "Fiscal & ERP",
  "Fabricação", "Equipe & governança", "Painel de TV",
];
const FRONT = [
  ["sec-legenda", "Legenda de status"],
  ["sec-integracoes", "Painel de integrações"],
  ["sec-mapa", "Mapa completo"],
];
const BACK = [
  ["sec-glossario", "Glossário"],
  ["sec-papeis", "Papéis e permissões"],
  ["sec-faq", "Perguntas frequentes"],
];
const tocItem = (href, label, num) =>
  `<li><a href="#${href}"><span class="t">${num ? `<b>${num}</b> · ` : ""}${label}</span><span class="d"></span></a></li>`;
const toc = `<section class="toc"><h1 class="toc-h">Sumário</h1><ol>
${FRONT.map(([h, l]) => tocItem(h, l)).join("\n")}
${PARTS.map((t, i) => tocItem(`part-${i + 1}`, t, i + 1)).join("\n")}
${BACK.map(([h, l]) => tocItem(h, l)).join("\n")}
</ol></section>`;

const cover = `
<section class="cover">
  <div class="cover-frame">
    <div class="cover-top">
      <span class="mono">HA</span>
      <span class="wordmark">HUB&nbsp;ADVISOR</span>
    </div>
    <div class="cover-mid">
      <div class="kicker">Comércio autônomo por IA</div>
      <h1 class="cover-title">Manual de<br>Operação</h1>
      <div class="cover-rule"></div>
      <p class="cover-sub">Guia completo de implantação e operação — passo a passo de cada tarefa, do primeiro acesso à venda assistida.</p>
    </div>
    <div class="cover-bottom">
      <span>Edição para impressão</span>
      <span>v1.0 · 2026</span>
    </div>
  </div>
</section>`;

const colophon = `
<section class="colophon">
  <h1>Sobre este manual</h1>
  <p>Este documento é o guia de referência da plataforma <b>Hub Advisor</b>. Ele explica,
  parte por parte, <b>o que fazer</b>, <b>o que cada passo destrava</b> e traz o
  <b>passo a passo (clique a clique)</b> de cada tarefa.</p>
  <p><b>A ordem importa:</b> cada parte liga capacidades que as seguintes aproveitam.
  Os ícones de status indicam o que já está no ar (🟢), o que aguarda credencial e
  roda simulado (🟡) e o que é opcional (⚪).</p>
  <p class="note">Gerado a partir da documentação viva do produto. Para a versão sempre
  atualizada e navegável, consulte o manual digital.</p>
</section>`;

const CSS = `
:root{ --brand:#b11e54; --brand2:#7a2247; --ink:#20242f; --muted:#6b6f7a; --line:#e7dde2; }
@page{
  size:A4; margin:24mm 18mm 20mm; bleed:3mm; marks:crop cross;
  @top-left{ content:"Hub Advisor"; font:7.5pt "Segoe UI",sans-serif; color:#c2b3ba; letter-spacing:1.5px; }
  @top-right{ content:string(part); font:7.5pt "Segoe UI",sans-serif; color:#c2b3ba; letter-spacing:.5px; }
  @bottom-center{ content:counter(page); font:8pt "Segoe UI",sans-serif; color:#9aa; }
}
@page cover{ margin:0; @top-left{content:none} @top-right{content:none} @bottom-center{content:none} }
@page nohead{ @top-left{content:none} @top-right{content:none} }

*{ box-sizing:border-box; }
html{ font:11pt/1.6 "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color:var(--ink); }
h1,h2,h3{ font-family:"Georgia","Times New Roman",serif; }

/* ---- Capa ---- */
.cover{ page:cover; break-after:page; overflow:hidden; }
.cover-frame{ height:279mm; padding:24mm; display:flex; flex-direction:column;
  border:2pt solid var(--brand); margin:9mm; }
.cover-top{ display:flex; align-items:center; gap:10pt; }
.cover-top .mono{ display:inline-flex; width:30pt; height:30pt; border-radius:50%; background:var(--brand);
  color:#fff; align-items:center; justify-content:center; font:700 13pt Georgia,serif; }
.cover-top .wordmark{ font:700 12pt "Segoe UI",sans-serif; letter-spacing:3px; color:var(--brand2); }
.cover-mid{ margin-top:auto; margin-bottom:auto; }
.kicker{ text-transform:uppercase; letter-spacing:4px; font-size:9pt; color:var(--muted); margin-bottom:10pt; }
.cover-title{ font-size:48pt; line-height:1.05; color:var(--brand); margin:0; }
.cover-rule{ width:70pt; height:4pt; background:var(--brand); margin:18pt 0; }
.cover-sub{ font-size:12.5pt; color:#3b3f4a; max-width:120mm; line-height:1.55; }
.cover-bottom{ display:flex; justify-content:space-between; font-size:9.5pt; color:var(--muted);
  letter-spacing:1px; border-top:1px solid var(--line); padding-top:10pt; }

/* ---- Colofão ---- */
.colophon{ page:nohead; break-before:page; padding-top:40mm; }
.colophon h1{ color:var(--brand); font-size:22pt; margin:0 0 14pt; }
.colophon p{ font-size:11.5pt; color:#33373f; max-width:140mm; }
.colophon .note{ margin-top:18pt; font-size:9.5pt; color:var(--muted); border-left:3px solid var(--line); padding-left:10pt; }

/* ---- Sumário ---- */
.toc{ page:nohead; break-before:page; }
.toc-h{ color:var(--brand); font-size:22pt; margin:0 0 16pt; }
.toc ol{ list-style:none; padding:0; margin:0; }
.toc li{ margin:7pt 0; }
.toc a{ display:flex; align-items:baseline; text-decoration:none; color:var(--ink); font-size:11.5pt; }
.toc a .t b{ color:var(--brand); }
.toc a .d{ flex:1; border-bottom:1px dotted #c9bfc5; margin:0 7px; transform:translateY(-3px); }
.toc a::after{ content: target-counter(attr(href), page); color:var(--muted); font-size:10.5pt; }

/* ---- Corpo ---- */
h2{ font-size:15pt; color:var(--brand); border-bottom:1px solid var(--line); padding-bottom:3pt; margin:16pt 0 8pt; }
h2.part{ string-set: part content(text); break-before:page; border:0; color:var(--brand);
  font-size:26pt; margin:0 0 4pt; padding-top:6mm; }
h2.part::before{ content:""; display:block; width:54pt; height:4pt; background:var(--brand); margin-bottom:10pt; }
h3{ font-size:12.5pt; color:var(--brand2); margin:12pt 0 4pt; }
p,li{ margin:4pt 0; }
a{ color:var(--brand2); text-decoration:none; }
code{ background:#f3eef1; padding:1px 4px; border-radius:3px; font:9.5pt "Consolas",monospace; }
blockquote{ margin:7pt 0; padding:5pt 12pt; border-left:3px solid #e4b9cc; background:#faf5f7; color:#50525e; border-radius:0 4px 4px 0; }
table{ border-collapse:collapse; width:100%; margin:8pt 0; font-size:9.5pt; break-inside:avoid; }
th,td{ border:1px solid var(--line); padding:4pt 7pt; text-align:left; vertical-align:top; }
th{ background:#f7eef2; color:var(--brand2); }
tr:nth-child(even) td{ background:#fcfafb; }
img{ max-width:100%; height:auto; border:1px solid #ece4e8; border-radius:6px; margin:6pt 0; break-inside:avoid; }
hr{ border:0; border-top:1px solid var(--line); margin:14pt 0; }
ul{ padding-left:18pt; } li{ break-inside:avoid; }

/* ---- Caixas "Passo a passo" ---- */
.howto{ border:1px solid #e4b9cc; border-radius:8px; margin:8pt 0 12pt; overflow:hidden; break-inside:avoid; }
.howto-bar{ background:var(--brand); color:#fff; font-weight:700; font-size:10pt; padding:5pt 12pt; font-family:"Segoe UI",sans-serif; }
.howto ol{ margin:8pt 0; padding-left:30pt; }
.howto li{ margin:4pt 0; }
.howto li b{ color:var(--brand2); }
`;

// Inlina o Paged.js (evita problema de caminho relativo do <script src>).
const pagedSrc = readFileSync("scripts/paged.polyfill.js", "utf8");
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<style>${CSS}</style>
<script>window.PagedConfig={ auto:true, after:()=>{ window.__pagedDone=true; } };<\/script>
<script>${pagedSrc}<\/script>
</head><body>${cover}${colophon}${toc}${body}</body></html>`;
writeFileSync(HTML, html);

// 3) Paged.js pagina no browser → page.pdf honra o @page (tamanho+sangria+marcas).
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(pathToFileURL(resolve(HTML)).href, { waitUntil: "load", timeout: 90_000 });
await page.waitForFunction(() => window.__pagedDone === true, { timeout: 120_000 });
const pages = await page.evaluate(() => document.querySelectorAll(".pagedjs_page").length);
await page.pdf({ path: PDF, preferCSSPageSize: true, printBackground: true });
await browser.close();
rmSync(HTML, { force: true });
console.log("ok", PDF, "·", pages, "páginas");
