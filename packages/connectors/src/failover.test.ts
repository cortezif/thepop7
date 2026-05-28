import { test } from "node:test";
import assert from "node:assert/strict";
import { createFailover, isRecoverableConnectorError } from "./failover.js";

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

test("classificação de erros recuperáveis", () => {
  assert.equal(isRecoverableConnectorError(new Error("503")), true);
  assert.equal(isRecoverableConnectorError(new Error("ETIMEDOUT timeout")), true);
  assert.equal(isRecoverableConnectorError(new Error("ECONNREFUSED")), true);
  assert.equal(isRecoverableConnectorError(new Error("400 bad request")), false);
  assert.equal(isRecoverableConnectorError(new Error("validation failed")), false);
});
