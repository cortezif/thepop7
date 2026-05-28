import type { ErpConnector, ErpProduct, ErpOrderInput } from "../types.js";

// Implementação Bling v3. Stub que documenta o contrato; preencher quando o
// token estiver disponível (Fase 0, Cortez).
//
// Docs: https://developer.bling.com.br/

export class BlingErp implements ErpConnector {
  async listProducts(_opts?: { limit?: number; updatedSince?: Date }): Promise<ErpProduct[]> {
    throw new Error("BlingErp.listProducts not implemented — falte token de produção");
  }
  async getProduct(_externalId: string): Promise<ErpProduct | null> {
    throw new Error("BlingErp.getProduct not implemented");
  }
  async getStock(_sku: string): Promise<number> {
    throw new Error("BlingErp.getStock not implemented");
  }
  async createOrder(_order: ErpOrderInput): Promise<{ externalId: string }> {
    throw new Error("BlingErp.createOrder not implemented");
  }
  async cancelOrder(_externalId: string, _reason: string): Promise<void> {
    throw new Error("BlingErp.cancelOrder not implemented");
  }
}
