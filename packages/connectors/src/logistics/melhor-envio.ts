import type { LogisticsConnector, QuoteInput, ShipmentInput, TrackingStatus } from "../types.js";
import type { ShippingQuote } from "@thepop/shared";

// Docs: https://docs.melhorenvio.com.br/
// Sandbox: melhorenvio.com.br/sandbox

export class MelhorEnvio implements LogisticsConnector {
  async quote(_input: QuoteInput): Promise<ShippingQuote[]> {
    throw new Error("MelhorEnvio.quote not implemented");
  }
  async createShipment(_input: ShipmentInput): Promise<{ trackingCode: string; labelUrl: string }> {
    throw new Error("MelhorEnvio.createShipment not implemented");
  }
  async track(_trackingCode: string): Promise<TrackingStatus[]> {
    throw new Error("MelhorEnvio.track not implemented");
  }
}
