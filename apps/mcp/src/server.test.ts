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

  await client.close();
});
