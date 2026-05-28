import type { PaymentConnector, ChargeInput, ChargeResult, ChargeStatus } from "../types.js";

// Docs: https://www.mercadopago.com.br/developers
// Implementar com token de produção da conta do tenant (não da plataforma).

export class MercadoPago implements PaymentConnector {
  async createCharge(_input: ChargeInput): Promise<ChargeResult> {
    throw new Error("MercadoPago.createCharge not implemented");
  }
  async getCharge(_externalId: string): Promise<ChargeStatus> {
    throw new Error("MercadoPago.getCharge not implemented");
  }
  async refund(_externalId: string, _amountBRL?: number): Promise<{ refundId: string }> {
    throw new Error("MercadoPago.refund not implemented");
  }
}
