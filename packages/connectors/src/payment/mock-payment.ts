import type { PaymentConnector, ChargeInput, ChargeResult, ChargeStatus } from "../types.js";

// Estado em memória pra simular ciclo de vida em desenvolvimento
const STORE = new Map<string, ChargeStatus>();

export class MockPayment implements PaymentConnector {
  async createCharge(input: ChargeInput): Promise<ChargeResult> {
    const externalId = "mock-charge-" + Date.now();
    STORE.set(externalId, { externalId, status: "pending" });
    return {
      externalId,
      status: "pending",
      pixQrCode: `00020126360014BR.GOV.BCB.PIX0114${input.externalReference}5204000053039865802BR5905MOCK6009SAO PAULO62070503***6304ABCD`,
      pixQrCodeBase64: "data:image/png;base64,MOCK_QR_CODE_BASE64",
      expiresAt: new Date(Date.now() + (input.expiresInMinutes ?? 30) * 60000).toISOString(),
    };
  }
  async getCharge(externalId: string): Promise<ChargeStatus> {
    return STORE.get(externalId) ?? { externalId, status: "pending" };
  }
  async refund(externalId: string, _amountBRL?: number): Promise<{ refundId: string }> {
    const c = STORE.get(externalId);
    if (c) STORE.set(externalId, { ...c, status: "refunded" });
    return { refundId: "mock-refund-" + Date.now() };
  }
}

// Para testes manuais: marcar charge como pago via util.
export function _mockApprove(externalId: string) {
  const c = STORE.get(externalId);
  if (c) STORE.set(externalId, { ...c, status: "approved", paidAt: new Date().toISOString() });
}
