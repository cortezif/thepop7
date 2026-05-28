import { test } from "node:test";
import assert from "node:assert/strict";
import { createFailover, isRecoverableConnectorError, __resetBreakers } from "./failover.js";

type Svc = { quote(): Promise<string>; ping(): string; region: string };
const svc = (over: Partial<Svc>): Svc => ({ async quote() { return "base"; }, ping: () => "base", region: "BR", ...over });

test("cai pro próximo da cadeia em erro recuperável", async () => {
  const calls: string[] = [];
  const failing = svc({ async quote() { calls.push("primary"); throw new Error("503 Service Unavailable"); } });
  const mock = svc({ async quote() { calls.push("mock"); return "ok-mock"; } });
  const fo = createFailover<Svc>([failing, mock]);
  assert.equal(await fo.quote(), "ok-mock");
  assert.deepEqual(calls, ["primary", "mock"]);
});

test("propaga erro NÃO recuperável (não tenta o fallback)", async () => {
  const calls: string[] = [];
  const fatal = svc({ async quote() { calls.push("primary"); throw new Error("400 invalid cep"); } });
  const mock = svc({ async quote() { calls.push("mock"); return "ok-mock"; } });
  const fo = createFailover<Svc>([fatal, mock]);
  await assert.rejects(() => fo.quote(), /400 invalid cep/);
  assert.deepEqual(calls, ["primary"], "não deve tocar no fallback em erro fatal");
});

test("usa o primário quando ele funciona", async () => {
  const calls: string[] = [];
  const ok = svc({ async quote() { calls.push("primary"); return "ok-real"; } });
  const mock = svc({ async quote() { calls.push("mock"); return "ok-mock"; } });
  assert.equal(await createFailover<Svc>([ok, mock]).quote(), "ok-real");
  assert.deepEqual(calls, ["primary"]);
});

test("métodos síncronos também ganham failover (viram async)", async () => {
  const a = svc({ ping: () => { throw new Error("timeout"); } });
  const b = svc({ ping: () => "from-b" });
  // ping vira async por causa do wrapper; em erro recuperável cai pro b
  assert.equal(await (createFailover<Svc>([a, b]).ping() as unknown as Promise<string>), "from-b");
});

test("propriedade de dado (não-função) passa direto pelo primeiro", () => {
  const a = svc({ region: "SP" });
  const b = svc({ region: "RJ" });
  assert.equal(createFailover<Svc>([a, b]).region, "SP");
});

test("cadeia vazia é erro de programação", () => {
  assert.throws(() => createFailover<Svc>([]), /cadeia vazia/);
});

test("circuit-breaker: abre o circuito do primário após o limite e o pula", async () => {
  __resetBreakers();
  let primaryCalls = 0, mockCalls = 0;
  const down = svc({ async quote() { primaryCalls++; throw new Error("503 unavailable"); } });
  const mock = svc({ async quote() { mockCalls++; return "mock"; } });
  // threshold 2: 2 falhas abrem o circuito; clock fixo em t=1000 (cooldown 30s).
  const fo = createFailover<Svc>([down, mock], { label: "cb-test-1", failureThreshold: 2, now: () => 1000 });
  await fo.quote(); // falha #1 no primário, cai pro mock
  await fo.quote(); // falha #2 → abre circuito do primário
  await fo.quote(); // circuito aberto → primário PULADO, vai direto no mock
  assert.equal(primaryCalls, 2, "primário não é mais chamado após abrir o circuito");
  assert.equal(mockCalls, 3, "mock atende as 3 chamadas");
});

test("circuit-breaker: cooldown expira e o primário volta a ser tentado", async () => {
  __resetBreakers();
  let primaryCalls = 0;
  let t = 1000;
  const down = svc({ async quote() { primaryCalls++; throw new Error("timeout"); } });
  const mock = svc({ async quote() { return "mock"; } });
  const fo = createFailover<Svc>([down, mock], { label: "cb-test-2", failureThreshold: 1, cooldownMs: 5000, now: () => t });
  await fo.quote(); // falha #1 (threshold 1) → abre por 5s
  await fo.quote(); // dentro do cooldown → primário pulado
  assert.equal(primaryCalls, 1);
  t = 7000; // passou o cooldown
  await fo.quote(); // circuito fechou → tenta o primário de novo
  assert.equal(primaryCalls, 2, "após o cooldown o primário é tentado novamente");
});

test("circuit-breaker: sucesso reseta o contador de falhas", async () => {
  __resetBreakers();
  let mode = "fail";
  let primaryCalls = 0;
  const flaky = svc({ async quote() { primaryCalls++; if (mode === "fail") throw new Error("503"); return "real"; } });
  const mock = svc({ async quote() { return "mock"; } });
  const fo = createFailover<Svc>([flaky, mock], { label: "cb-test-3", failureThreshold: 3, now: () => 1000 });
  await fo.quote(); // falha 1
  mode = "ok";
  assert.equal(await fo.quote(), "real"); // sucesso → reseta
  mode = "fail";
  await fo.quote(); // falha 1 de novo (não 2) — não abre
  assert.equal(primaryCalls, 3, "primário tentado nas 3 (não foi pulado, pois sucesso resetou)");
});

test("classificação de erros recuperáveis", () => {
  assert.equal(isRecoverableConnectorError(new Error("503")), true);
  assert.equal(isRecoverableConnectorError(new Error("ETIMEDOUT timeout")), true);
  assert.equal(isRecoverableConnectorError(new Error("ECONNREFUSED")), true);
  assert.equal(isRecoverableConnectorError(new Error("400 bad request")), false);
  assert.equal(isRecoverableConnectorError(new Error("validation failed")), false);
});
