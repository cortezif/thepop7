import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "./prompt.js";
import type { AgentConfig, ConversationContext } from "./types.js";

// Bloco proativo de cashback no system prompt (ADR-031).

const cfg: AgentConfig = { tenantId: "t1", persona: "Maya", tone: "", policies: {}, storeName: "Loja X" };
const baseCtx: ConversationContext = {
  conversationId: "c1", channel: "whatsapp", contactProfile: {}, recentMessages: [],
};

test("prompt: cita cashback a vencer quando há saldo", () => {
  const { contextBlock } = buildSystemPrompt(cfg, { ...baseCtx, cashback: { saldoBRL: 25, expiringBRL: 25, daysLeft: 3 } });
  assert.match(contextBlock, /CASHBACK DA CLIENTE/);
  assert.match(contextBlock, /R\$ 25\.00/);
  assert.match(contextBlock, /VENCE em 3 dia/);
});

test("prompt: sem bloco de cashback quando saldo zero ou ausente", () => {
  assert.doesNotMatch(buildSystemPrompt(cfg, baseCtx).contextBlock, /CASHBACK DA CLIENTE/);
  assert.doesNotMatch(
    buildSystemPrompt(cfg, { ...baseCtx, cashback: { saldoBRL: 0, expiringBRL: 0, daysLeft: null } }).contextBlock,
    /CASHBACK DA CLIENTE/,
  );
});

test("prompt: saldo sem vencimento próximo não menciona prazo", () => {
  const { contextBlock } = buildSystemPrompt(cfg, { ...baseCtx, cashback: { saldoBRL: 40, expiringBRL: 0, daysLeft: null } });
  assert.match(contextBlock, /R\$ 40\.00/);
  assert.doesNotMatch(contextBlock, /VENCE em/);
});
