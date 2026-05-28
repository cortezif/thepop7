import type { FiscalConnector, NfeInput, NfeResult } from "../types.js";

// Docs: https://docs.plugnotas.com.br/

export class PlugNotas implements FiscalConnector {
  async issueNfe(_input: NfeInput): Promise<NfeResult> {
    throw new Error("PlugNotas.issueNfe not implemented");
  }
}
