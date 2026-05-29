import { test } from "node:test";
import assert from "node:assert/strict";
import { erpProvider, fiscalProvider } from "./factory.js";

test("erpProvider: default tray; bling explícito; case-insensitive", () => {
  delete process.env.ERP_PROVIDER;
  assert.equal(erpProvider(), "tray");
  process.env.ERP_PROVIDER = "bling";
  assert.equal(erpProvider(), "bling");
  process.env.ERP_PROVIDER = "BLING";
  assert.equal(erpProvider(), "bling");
  process.env.ERP_PROVIDER = "qualquer";
  assert.equal(erpProvider(), "tray"); // valor desconhecido → default
  delete process.env.ERP_PROVIDER;
});

test("fiscalProvider: default cplug (a loja usa CPlug); plugnotas explícito", () => {
  delete process.env.FISCAL_PROVIDER;
  assert.equal(fiscalProvider(), "cplug");
  process.env.FISCAL_PROVIDER = "plugnotas";
  assert.equal(fiscalProvider(), "plugnotas");
  process.env.FISCAL_PROVIDER = "PlugNotas";
  assert.equal(fiscalProvider(), "plugnotas");
  process.env.FISCAL_PROVIDER = "outro";
  assert.equal(fiscalProvider(), "cplug"); // desconhecido → default
  delete process.env.FISCAL_PROVIDER;
});
