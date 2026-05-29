import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env"), override: true });

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "./server.js";

// Servidor MCP da rede de atacado B2B (ADR-024) sobre stdio. Conecte um cliente
// MCP (Claude Desktop, outro agente) apontando pra: node dist/main.js
// (ou tsx src/main.ts em dev). Logs vão pra stderr — stdout é o canal do protocolo.
async function main() {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] thepop7-b2b conectado (stdio)");
}

main().catch((err) => { console.error("[mcp] falha:", err); process.exit(1); });
