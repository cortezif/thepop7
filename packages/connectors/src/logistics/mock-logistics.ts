import type { LogisticsConnector, QuoteInput, ShipmentInput, TrackingStatus } from "../types.js";
import type { ShippingQuote } from "@thepop/shared";

export class MockLogistics implements LogisticsConnector {
  async quote(_input: QuoteInput): Promise<ShippingQuote[]> {
    return [
      { carrier: "Correios", service: "PAC",   priceBRL: 18.9, deliveryDays: 7 },
      { carrier: "Correios", service: "Sedex", priceBRL: 24.9, deliveryDays: 3 },
      { carrier: "Loggi",    service: "Express",priceBRL: 22.0, deliveryDays: 2 },
    ];
  }
  async createShipment(input: ShipmentInput): Promise<{ trackingCode: string; labelUrl: string }> {
    return {
      trackingCode: "MOCK" + input.orderExternalId.slice(-6).toUpperCase() + "BR",
      labelUrl: "https://example.com/etiqueta-mock.pdf",
    };
  }
  async track(trackingCode: string): Promise<TrackingStatus[]> {
    return [
      { status: "posted",           description: "Objeto postado",         timestamp: new Date(Date.now() - 86400000 * 2).toISOString() },
      { status: "in_transit",       description: "Em trânsito",            timestamp: new Date(Date.now() - 86400000).toISOString() },
      { status: "out_for_delivery", description: "Saiu para entrega",      timestamp: new Date(Date.now() - 3600000).toISOString(), location: "CD São Paulo" },
    ];
  }
}
