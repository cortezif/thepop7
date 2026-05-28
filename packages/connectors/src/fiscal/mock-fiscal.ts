import type { FiscalConnector, NfeInput, NfeResult } from "../types.js";

export class MockFiscal implements FiscalConnector {
  async issueNfe(input: NfeInput): Promise<NfeResult> {
    const num = "000" + Math.floor(Math.random() * 999999).toString().padStart(6, "0");
    return {
      number: num,
      xmlUrl: `https://example.com/nfe/${input.orderId}.xml`,
      pdfUrl: `https://example.com/nfe/${input.orderId}.pdf`,
    };
  }
}
