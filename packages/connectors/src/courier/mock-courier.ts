import type {
  CourierConnector, CourierQuoteInput, CourierQuote,
  CourierDispatchInput, CourierDispatch, CourierStatus,
} from "../types.js";

// Mock de entrega on-demand (dev/sem credencial). Cotação determinística a partir
// da distância em linha reta (haversine) — permite exercitar o fluxo sem provider.

/** Distância em km entre dois pontos (haversine). Pura. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 100) / 100;
}

/** Tarifa-mock: base + por km, mais caro de carro. Pura. */
export function mockCourierPrice(km: number, modal: "moto" | "carro"): number {
  const base = modal === "carro" ? 12 : 6;
  const perKm = modal === "carro" ? 3.5 : 2;
  return Math.round((base + perKm * km) * 100) / 100;
}

export class MockCourier implements CourierConnector {
  async quoteCourier(input: CourierQuoteInput): Promise<CourierQuote> {
    const modal = input.modal ?? "moto";
    const km = haversineKm(input.pickup, input.dropoff);
    return {
      provider: "mock",
      quotationId: `mock-${km}`,
      priceBRL: mockCourierPrice(km, modal),
      modal,
      distanceKm: km,
      etaMinutes: Math.max(15, Math.round(km * 4)),
    };
  }

  async dispatch(input: CourierDispatchInput): Promise<CourierDispatch> {
    return {
      provider: "mock",
      deliveryId: `mock-delivery-${input.orderRef ?? "x"}`,
      status: "assigned",
      priceBRL: input.quote?.priceBRL,
      trackingUrl: undefined,
    };
  }

  async getStatus(_deliveryId: string): Promise<CourierStatus> {
    return { status: "assigned", rawStatus: "MOCK_ASSIGNED" };
  }
}
