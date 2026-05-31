// Edição de IMPRESSÃO (gráfica) — design "corporativo bold, cor cheia".
// Capa full-bleed + divisórias de capítulo full-bleed com numeral gigante +
// telas emolduradas como janela + passos com círculos numerados + fontes próprias.
// Sumário paginado (Paged.js), sangria 3mm + marcas de corte (A4).
// Uso: node scripts/manual-print.mjs
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
const f64 = (p) => readFileSync(p).toString("base64");

const FONT = {
  sg700: f64("scripts/fonts/sg700.woff2"), sg500: f64("scripts/fonts/sg500.woff2"),
  in400: f64("scripts/fonts/in400.woff2"), in600: f64("scripts/fonts/in600.woff2"), in700: f64("scripts/fonts/in700.woff2"),
};
const ff = (name, w, b64) => `@font-face{font-family:'${name}';font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;

const PARTS = [
  ["Fundação", "A loja existe, fala a sua língua e a IA entra no ar"],
  ["Canais de conversa", "Os clientes te chamam e a IA responde"],
  ["Catálogo & estoque", "A IA tem o que vender e você controla o que tem"],
  ["Pagamento & entrega", "O pedido vira dinheiro e chega no cliente"],
  ["Atendimento & pedidos", "O dia a dia da venda assistida por IA"],
  ["Fidelidade & marketing", "O cliente volta e você atrai novos"],
  ["Pós-venda & satisfação", "O cliente bem cuidado depois da entrega"],
  ["Clientes & perfis", "A IA trata cada cliente do jeito certo"],
  ["Compras & mercadológica", "Você compra melhor, com preço comparado"],
  ["Financeiro", "Você enxerga o caixa em tempo real"],
  ["Fiscal & ERP", "Nota fiscal e integração com a gestão"],
  ["Fabricação", "Para quem produz o que vende"],
  ["Equipe & governança", "Controle de acesso e conformidade"],
  ["Painel de TV", "Monitorar a operação do dia numa TV"],
];

// 1) Markdown → HTML
let body = execSync(`npx -y marked --gfm -i ${MD}`, { encoding: "utf8", maxBuffer: 1e8 });
const start = body.search(/<h2[^>]*>Legenda/);
if (start > 0) body = body.slice(start);

// Substitui cada "Parte N — Título" por uma DIVISÓRIA full-bleed (página inteira).
body = body.replace(/<h2[^>]*>Parte (\d+)[^<]*<\/h2>/g, (m, n) => {
  const [title, tag] = PARTS[+n - 1];
  return `<section class="divider" id="part-${n}">
    <div class="dz-num">${String(n).padStart(2, "0")}</div>
    <div class="dz-info"><div class="dz-kicker">PARTE ${n}</div>
    <div class="dz-title">${title}</div><div class="dz-tag">${tag}</div></div>
  </section>`;
});

// ids explícitos nas seções do sumário.
const SECID = [
  [/<h2([^>]*)>Legenda de status<\/h2>/, "sec-legenda"],
  [/<h2([^>]*)>Painel de integrações[\s\S]*?<\/h2>/, "sec-integracoes"],
  [/<h2([^>]*)>Mapa completo[\s\S]*?<\/h2>/, "sec-mapa"],
  [/<h2([^>]*)>Glossário<\/h2>/, "sec-glossario"],
  [/<h2([^>]*)>Papéis e permissões<\/h2>/, "sec-papeis"],
  [/<h2([^>]*)>Perguntas frequentes[\s\S]*?<\/h2>/, "sec-faq"],
];
for (const [re, id] of SECID) body = body.replace(re, (m) => m.replace(/^<h2/, `<h2 id="${id}"`));
body = body.replace(/<h2(?![^>]*id=)([^>]*)>([\s\S]*?)<\/h2>/g, (m, a, t) => `<h2${a} id="${slug(t)}">${t}</h2>`);

// "Destrava" / "Mostra" viram callout destacado.
body = body.replace(/<p><strong>(Destrava[^<]*|Mostra[^<]*)<\/strong>([\s\S]*?)<\/p>/g,
  (m, label, rest) => `<div class="unlocks"><span class="unlocks-tag">▸ ${label.replace(/:$/, "")}</span>${rest}</div>`);

// Imagens viram "janela" (browser chrome) com legenda.
body = body.replace(/<p><img src="([^"]+)"(?:\s+alt="([^"]*)")?[^>]*><\/p>/g,
  (m, src, alt) => `<figure class="shot"><div class="shot-bar"><i></i><i></i><i></i><span class="shot-url">painel · hubadvisor</span></div>` +
    `<div class="shot-body"><img src="${src}"></div></figure>${alt ? `<p class="shot-cap">${alt}</p>` : ""}`);

// 2) Sumário
const FRONT = [["sec-legenda", "Legenda de status"], ["sec-integracoes", "Painel de integrações"], ["sec-mapa", "Mapa completo"]];
const BACK = [["sec-glossario", "Glossário"], ["sec-papeis", "Papéis e permissões"], ["sec-faq", "Perguntas frequentes"]];
const tocItem = (href, label, num) =>
  `<li><a href="#${href}"><span class="t">${num ? `<b>${String(num).padStart(2, "0")}</b>&nbsp;&nbsp;` : ""}${label}</span><span class="d"></span></a></li>`;
const toc = `<section class="toc"><div class="toc-h">Sumário</div><ol>
${FRONT.map(([h, l]) => tocItem(h, l)).join("\n")}
${PARTS.map(([t], i) => tocItem(`part-${i + 1}`, t, i + 1)).join("\n")}
${BACK.map(([h, l]) => tocItem(h, l)).join("\n")}
</ol></section>`;

const cover = `<section class="cover">
  <div class="cv-grid"></div>
  <div class="cv-top"><span class="cv-mono">HA</span><span class="cv-wm">HUB ADVISOR</span></div>
  <div class="cv-mid">
    <div class="cv-kick">COMÉRCIO AUTÔNOMO POR IA</div>
    <div class="cv-title">Manual de<br>Operação</div>
    <div class="cv-sub">Guia completo de implantação e operação — o passo a passo de cada tarefa, do primeiro acesso à venda assistida.</div>
  </div>
  <div class="cv-foot"><span>EDIÇÃO PARA IMPRESSÃO</span><span>v1.0 · 2026</span></div>
</section>`;

const colophon = `<section class="colophon">
  <div class="cl-num">01</div>
  <h1>Como usar este manual</h1>
  <p>Este é o guia de referência da plataforma <b>Hub Advisor</b>. Para cada tarefa ele mostra
  <b>o que fazer</b>, <b>o que aquilo destrava</b> e o <b>passo a passo clique a clique</b>.</p>
  <p><b>A ordem importa:</b> cada parte liga capacidades que as seguintes aproveitam. Os selos de
  status indicam o que já está no ar (🟢), o que aguarda credencial e roda simulado (🟡) e o que é
  opcional (⚪).</p>
  <p class="cl-note">Documento gerado a partir da base viva do produto. Para a versão sempre atualizada
  e navegável, consulte o manual digital.</p>
</section>`;

const CSS = `
${ff("Space Grotesk", 700, FONT.sg700)}${ff("Space Grotesk", 500, FONT.sg500)}
${ff("Inter", 400, FONT.in400)}${ff("Inter", 600, FONT.in600)}${ff("Inter", 700, FONT.in700)}
:root{ --brand:#c01c5b; --brand-d:#8a0f3f; --ink:#1a1c22; --muted:#6b6f7a; --line:#ece5e9; --bg:#ffffff; }
*{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
html{ font-family:'Inter',sans-serif; font-size:10.5pt; line-height:1.6; color:var(--ink); }

@page{
  size:A4; margin:22mm 18mm 18mm; bleed:3mm; marks:crop cross;
  @top-left{ content:"HUB ADVISOR"; font-family:'Inter'; font-size:7pt; font-weight:700; letter-spacing:2px; color:#c9bcc4; }
  @top-right{ content:string(part); font-family:'Inter'; font-size:7pt; font-weight:600; letter-spacing:.5px; color:#c9bcc4; }
  @bottom-right{ content:counter(page); font-family:'Space Grotesk'; font-weight:700; font-size:10pt; color:var(--brand); }
}
@page nobars{ margin:0; @top-left{content:none}@top-right{content:none}@bottom-right{content:none} }

/* ===== CAPA (full-bleed cor cheia) ===== */
.cover{ page:nobars; break-after:page; position:relative; height:303mm; width:216mm; margin:-3mm;
  background:linear-gradient(150deg,var(--brand) 0%, var(--brand-d) 100%); color:#fff;
  padding:30mm 26mm; display:flex; flex-direction:column; overflow:hidden; }
.cv-grid{ position:absolute; inset:0;
  background-image:linear-gradient(#ffffff14 1px,transparent 1px),linear-gradient(90deg,#ffffff14 1px,transparent 1px);
  background-size:18mm 18mm; opacity:.5; }
.cover>*{ position:relative; }
.cv-top{ display:flex; align-items:center; gap:11pt; }
.cv-mono{ width:34pt;height:34pt;border:2pt solid #fff;border-radius:50%; display:flex;align-items:center;justify-content:center; font-family:'Space Grotesk';font-weight:700;font-size:14pt; }
.cv-wm{ font-family:'Inter';font-weight:700;letter-spacing:5px;font-size:11pt; }
.cv-mid{ margin-top:auto; }
.cv-kick{ font-weight:600;letter-spacing:5px;font-size:9pt;opacity:.85;margin-bottom:12pt; }
.cv-title{ font-family:'Space Grotesk';font-weight:700;font-size:62pt;line-height:.98;letter-spacing:-1pt; }
.cv-sub{ margin-top:20pt;font-size:12pt;line-height:1.5;max-width:120mm;opacity:.92; }
.cv-foot{ margin-top:auto;display:flex;justify-content:space-between;font-size:8.5pt;font-weight:600;letter-spacing:2px;opacity:.85;border-top:1px solid #ffffff44;padding-top:12pt; }

/* ===== DIVISÓRIA DE CAPÍTULO (full-bleed) ===== */
.divider{ page:nobars; break-before:page; position:relative; height:303mm;width:216mm;margin:-3mm;
  background:var(--brand); color:#fff; padding:34mm 26mm; display:flex;flex-direction:column;justify-content:center; overflow:hidden;
  string-set: part content(); }
.dz-num{ font-family:'Space Grotesk';font-weight:700;font-size:220pt;line-height:.8;color:#ffffff1f;position:absolute;top:14mm;right:18mm; }
.dz-info{ position:relative;margin-top:auto; }
.dz-kicker{ font-weight:700;letter-spacing:6px;font-size:11pt;opacity:.8; }
.dz-title{ font-family:'Space Grotesk';font-weight:700;font-size:44pt;line-height:1.02;margin:10pt 0 0; string-set: part content(); }
.dz-tag{ font-size:14pt;opacity:.92;margin-top:14pt;max-width:130mm;border-top:2pt solid #ffffff55;padding-top:14pt; }

/* ===== COLOFÃO ===== */
.colophon{ page:nobars; break-before:page; padding:34mm 26mm; position:relative; }
.cl-num{ font-family:'Space Grotesk';font-weight:700;font-size:120pt;color:#f3e6ec;position:absolute;top:18mm;right:24mm;line-height:1; }
.colophon h1{ font-family:'Space Grotesk';font-weight:700;font-size:30pt;color:var(--brand);margin:48mm 0 16pt;position:relative; }
.colophon p{ font-size:12pt;max-width:135mm;color:#34373f;position:relative; }
.cl-note{ margin-top:20pt;font-size:9.5pt;color:var(--muted);border-left:3pt solid var(--brand);padding-left:12pt; }

/* ===== SUMÁRIO ===== */
.toc{ page:nobars; break-before:page; break-after:page; padding:34mm 26mm; }
.toc-h{ font-family:'Space Grotesk';font-weight:700;font-size:34pt;color:var(--brand);margin-bottom:22pt; }
.toc ol{ list-style:none;padding:0;margin:0; }
.toc li{ margin:9pt 0; }
.toc a{ display:flex;align-items:baseline;text-decoration:none;color:var(--ink);font-size:12pt; }
.toc a .t b{ font-family:'Space Grotesk';color:var(--brand); }
.toc a .d{ flex:1;border-bottom:1.4pt dotted #d9ccd3;margin:0 8px;transform:translateY(-3px); }
.toc a::after{ content: target-counter(attr(href), page); font-family:'Space Grotesk';font-weight:700;color:var(--brand); }

/* ===== CORPO ===== */
h2{ font-family:'Space Grotesk';font-weight:700;font-size:17pt;color:var(--ink);margin:18pt 0 8pt;padding-bottom:5pt;border-bottom:2pt solid var(--brand); }
h3{ font-family:'Space Grotesk';font-weight:500;font-size:12.5pt;color:var(--brand-d);margin:14pt 0 4pt; }
p,li{ margin:4pt 0; }
strong{ font-weight:700; }
a{ color:var(--brand-d);text-decoration:none; }
code{ background:#f5eef2;color:var(--brand-d);padding:1px 5px;border-radius:4px;font-family:'Consolas',monospace;font-size:9pt; }
blockquote{ margin:8pt 0;padding:8pt 14pt;background:#faf4f7;border-radius:10px;color:#4a4d57;font-size:10.5pt; }
hr{ display:none; }
ul{ padding-left:16pt;margin:5pt 0; }
ul li::marker{ color:var(--brand); }

/* tabelas */
table{ border-collapse:separate;border-spacing:0;width:100%;margin:9pt 0;font-size:9pt;break-inside:avoid;border:1px solid var(--line);border-radius:10px;overflow:hidden; }
th,td{ padding:6pt 9pt;text-align:left;vertical-align:top;border-bottom:1px solid var(--line); }
th{ background:var(--brand);color:#fff;font-family:'Inter';font-weight:600;font-size:8.5pt;letter-spacing:.3px; }
tr:last-child td{ border-bottom:0; }
tbody tr:nth-child(even) td{ background:#fbf7f9; }

/* selo "Destrava" */
.unlocks{ background:#f7fbf7;border:1px solid #d8ecd8;border-left:4pt solid #36a35a;border-radius:8px;padding:8pt 12pt;margin:8pt 0;font-size:10pt;color:#2a3b2e; }
.unlocks-tag{ display:block;font-family:'Inter';font-weight:700;font-size:8pt;letter-spacing:1px;color:#2f8a4d;text-transform:uppercase;margin-bottom:2pt; }

/* tela emoldurada (janela) */
.shot{ margin:10pt 0 3pt;border:1px solid #e3dbe0;border-radius:12px;overflow:hidden;box-shadow:0 2pt 0 #efe8ec;break-inside:avoid; }
.shot-bar{ display:flex;align-items:center;gap:6pt;background:#f3eef1;padding:6pt 10pt;border-bottom:1px solid #e7dee4; }
.shot-bar i{ width:8pt;height:8pt;border-radius:50%;background:#cdbcc6;display:inline-block; }
.shot-bar i:first-child{ background:#e06a6a; } .shot-bar i:nth-child(2){ background:#e0b24a; } .shot-bar i:nth-child(3){ background:#5ab36b; }
.shot-url{ margin-left:8pt;font-size:7.5pt;color:#9c8e96;letter-spacing:.5px; }
.shot-body img{ display:block;width:100%; }
.shot-cap{ font-size:8pt;color:var(--muted);margin:0 0 8pt;font-style:italic; }

/* caixa "Passo a passo" — círculos numerados */
.howto{ background:#fbf3f7;border:1px solid #f0dbe6;border-radius:12px;padding:12pt 16pt 14pt;margin:9pt 0 12pt;break-inside:avoid; }
.howto-bar{ font-family:'Inter';font-weight:700;font-size:9.5pt;letter-spacing:.5px;color:var(--brand);text-transform:uppercase;margin-bottom:8pt; }
.howto ol{ list-style:none;counter-reset:s;padding:0;margin:0; }
.howto li{ counter-increment:s;position:relative;padding-left:26pt;margin:6pt 0;font-size:10pt; }
.howto li::before{ content:counter(s);position:absolute;left:0;top:.5pt;width:17pt;height:17pt;border-radius:50%;background:var(--brand);color:#fff;font-family:'Space Grotesk';font-weight:700;font-size:8.5pt;display:flex;align-items:center;justify-content:center; }
.howto li b{ color:var(--brand-d); }
`;

const pagedSrc = readFileSync("scripts/paged.polyfill.js", "utf8");
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${CSS}</style>
<script>window.PagedConfig={ auto:true, after:()=>{ window.__pagedDone=true; } };<\/script>
<script>${pagedSrc}<\/script></head><body>${cover}${colophon}${toc}${body}</body></html>`;
writeFileSync(HTML, html);

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(pathToFileURL(resolve(HTML)).href, { waitUntil: "load", timeout: 90_000 });
await page.waitForFunction(() => window.__pagedDone === true, { timeout: 120_000 });
const pages = await page.evaluate(() => document.querySelectorAll(".pagedjs_page").length);
await page.pdf({ path: PDF, preferCSSPageSize: true, printBackground: true });
await browser.close();
rmSync(HTML, { force: true });
console.log("ok", PDF, "·", pages, "páginas");
