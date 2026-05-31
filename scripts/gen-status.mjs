// Gera a tabela "Painel de integrações" do manual a partir do status REAL da loja.
// Uso: SHOT_TOKEN=... [SHOT_TENANT=thepop7] node scripts/gen-status.mjs
// Reescreve o trecho entre <!-- INTEGRACOES:START --> e <!-- INTEGRACOES:END -->.
import { readFile, writeFile } from "node:fs/promises";

const TOKEN = process.env.SHOT_TOKEN;
const TENANT = process.env.SHOT_TENANT ?? "thepop7";
const API = process.env.SHOT_API ?? "http://localhost:3001";
if (!TOKEN) { console.error("defina SHOT_TOKEN"); process.exit(1); }

// provider | rótulo | onde ligar | env no servidor | opcional?
const PROVIDERS = [
  ["anthropic",   "Anthropic Claude (IA)",        "Configurações",               "`ANTHROPIC_API_KEY`", false],
  ["whatsapp",    "WhatsApp Business Cloud",       "Configurações → WhatsApp",     "`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN`", false],
  ["instagram",   "Instagram / Facebook",         "Configurações → Instagram",    "`INSTAGRAM_ACCESS_TOKEN`, `META_APP_ID`, `META_APP_SECRET`", false],
  ["mercadopago", "Mercado Pago (pagamento)",      "Configurações → Mercado Pago", "`MERCADOPAGO_ACCESS_TOKEN`", false],
  ["melhor-envio","Melhor Envio (frete)",          "Configurações → Melhor Envio", "`MELHORENVIO_ACCESS_TOKEN`", false],
  ["tray",        "Tray Commerce (ERP)",           "Configurações → Tray",         "`ERP_PROVIDER=tray`, `TRAY_CONSUMER_KEY/SECRET`, `TRAY_ACCESS_TOKEN`", false],
  ["cplug",       "CPlug (NFe / fiscal)",          "Configurações → CPlug",        "`FISCAL_PROVIDER=cplug`, `CPLUG_*`", false],
  ["zenvia",      "SMS (Zenvia)",                  "Configurações → SMS",          "`ZENVIA_TOKEN`, `ZENVIA_FROM`", false],
  ["lalamove",    "Lalamove (entregador on-demand)","Configurações → Lalamove",    "`LALAMOVE_API_KEY/SECRET`, `LALAMOVE_MARKET`", true],
  ["opendelivery","Open Delivery (entregador)",    "Configurações → Open Delivery","`OPENDELIVERY_BASE_URL`, `OPENDELIVERY_CLIENT_*`", true],
];

function badge(connected, optional) {
  if (connected) return "🟢 LIVE";
  return optional ? "⚪ Opcional" : "🟡 Aguardando";
}

const rows = [];
for (const [p, label, where, env, optional] of PROVIDERS) {
  let connected = false, note = "";
  try {
    const r = await fetch(`${API}/api/integrations/${p}?tenantSlug=${TENANT}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const j = await r.json();
    connected = !!j.connected;
    note = (j.note ?? "").replace(/\|/g, "·");
  } catch (e) { note = "status indisponível"; }
  rows.push(`| **${label}** | ${where} | ${env} | ${badge(connected, optional)} |`);
  console.log(`${connected ? "🟢" : optional ? "⚪" : "🟡"} ${p}`);
}

const stamp = (process.env.SHOT_DATE ?? "").trim();
const table = [
  `> Gerado automaticamente do status real da loja **${TENANT}**${stamp ? ` em ${stamp}` : ""} (\`scripts/gen-status.mjs\`).`,
  "",
  "| Integração | Onde ligar | Credencial / env no servidor | Status |",
  "|-----------|-----------|------------------------------|--------|",
  ...rows,
].join("\n");

const path = "docs/manual-operacao.md";
const md = await readFile(path, "utf8");
const START = "<!-- INTEGRACOES:START -->", END = "<!-- INTEGRACOES:END -->";
const i = md.indexOf(START), j = md.indexOf(END);
if (i === -1 || j === -1) { console.error("marcadores INTEGRACOES não encontrados no manual"); process.exit(1); }
const out = md.slice(0, i + START.length) + "\n" + table + "\n" + md.slice(j);
await writeFile(path, out);
console.log("manual atualizado:", path);
