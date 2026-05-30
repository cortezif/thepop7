import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer, B2B_TOOL_NAMES } from "./server.js";

test("MCP B2B: cliente lista as 7 ferramentas de atacado", async () => {
  const server = buildMcpServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [...B2B_TOOL_NAMES].sort());
  // cada ferramenta tem descrição
  assert.ok(tools.every((t) => typeof t.description === "string" && t.description.length > 0));

  // as ferramentas de escrita NÃO expõem buyerRef (vem do comprador autenticado)
  const quote = tools.find((t) => t.name === "request_quote")!;
  assert.ok(!Object.keys(quote.inputSchema.properties ?? {}).includes("buyerRef"));

  await client.close();
});

test("MCP B2B: sessão anônima recusa cotação (sem comprador autenticado)", async () => {
  const server = buildMcpServer({}); // sem buyerRef
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);

  const r: any = await client.callTool({ name: "request_quote", arguments: { items: [{ productId: "x", qty: 5 }] } });
  assert.match(JSON.parse(r.content[0].text).error, /não autenticado/);
  await client.close();
});
