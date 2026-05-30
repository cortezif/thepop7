import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env"), override: true });

import { createBuyer } from "@thepop/b2b";

// Provisiona um comprador da rede de atacado e imprime a API-key (uma única vez).
// Uso: node --import tsx apps/mcp/src/create-buyer.ts "Nome da Loja Compradora"
const name = process.argv[2];
if (!name) { console.error('uso: create-buyer.ts "Nome do comprador"'); process.exit(1); }

createBuyer(name).then((b) => {
  console.log(JSON.stringify({ buyerId: b.buyerId, name: b.name, apiKey: b.apiKey }, null, 2));
  console.log("\n⚠️  Guarde a apiKey: ela é mostrada só agora. Configure no cliente MCP como MCP_BUYER_API_KEY.");
  process.exit(0);
}).catch((e) => { console.error("falha:", e); process.exit(1); });
