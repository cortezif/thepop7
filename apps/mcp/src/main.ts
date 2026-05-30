import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// stdout é o canal do protocolo MCP — impede o Prisma de logar query nele.
process.env.PRISMA_DISABLE_QUERY_LOG = "true";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env"), override: true });

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "./server.js";
import { resolveBuyer } from "@thepop/b2b";

// Servidor MCP da rede de atacado B2B (ADR-024) sobre stdio. Conecte um cliente
// MCP (Claude Desktop, outro agente) apontando pra: node dist/main.js
// (ou tsx src/main.ts em dev). Logs vão pra stderr — stdout é o canal do protocolo.
async function main() {
  // Autentica o comprador pela API-key do env (cada comprador roda o servidor
  // com a sua). Sem key válida → sessão anônima (só leitura do catálogo).
  const buyer = await resolveBuyer(process.env.MCP_BUYER_API_KEY);
  const server = buildMcpServer({ buyerRef: buyer?.id });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(buyer ? `[mcp] thepop7-b2b conectado — comprador: ${buyer.name}` : "[mcp] thepop7-b2b conectado (anônimo: só leitura)");
}

main().catch((err) => { console.error("[mcp] falha:", err); process.exit(1); });
