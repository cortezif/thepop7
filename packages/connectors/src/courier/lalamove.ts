import crypto from "node:crypto";
import type {
  CourierConnector, CourierQuoteInput, CourierQuote,
  CourierDispatchInput, CourierDispatch, CourierStatus, CourierModal,
} from "../types.js";

// Lalamove (entrega on-demand, ADR-030). API v3 REST, auth HMAC-SHA256.
// Docs: https://developers.lalamove.com/  (sandbox: rest.sandbox.lalamove.com)
//
// As funções de assinatura e de montagem/parse de payload são puras (testáveis
// sem rede). O Lalamove cobre capitais/grandes cidades — para o interior, o
// adaptador Open Delivery (Pedidos10) usa a MESMA interface CourierConnector.

const SANDBOX = "https://rest.sandbox.lalamove.com";
const PROD = "https://rest.lalamove.com";

/** modal interno → serviceType da Lalamove (BR). Configurável por env. */
export function lalamoveServiceType(modal: CourierModal | undefined): string {
  if (modal === "carro") return process.env.LALAMOVE_SERVICE_CARRO ?? "SEDAN";
  return process.env.LALAMOVE_SERVICE_MOTO ?? "MOTORCYCLE";
}

/**
 * Assinatura HMAC do Lalamove (pura). String assinada:
 *   `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`
 * Header final: `Authorization: hmac ${apiKey}:${timestamp}:${signature}`.
 */
export function lalamoveSignature(opts: {
  secret: string; timestamp: string; method: string; path: string; body: string;
}): string {
  const raw = `${opts.timestamp}\r\n${opts.method.toUpperCase()}\r\n${opts.path}\r\n\r\n${opts.body}`;
  return crypto.createHmac("sha256", opts.secret).update(raw).digest("hex");
}

/** Monta o corpo do POST /v3/quotations (pura). */
export function buildLalamoveQuoteBody(input: CourierQuoteInput): Record<string, unknown> {
  return {
    data: {
      serviceType: lalamoveServiceType(input.modal),
      language: "pt_BR",
      stops: [
        { coordinates: { lat: String(input.pickup.lat), lng: String(input.pickup.lng) }, address: input.pickup.address ?? "" },
        { coordinates: { lat: String(input.dropoff.lat), lng: String(input.dropoff.lng) }, address: input.dropoff.address ?? "" },
      ],
    },
  };
}

/** Parse da resposta de /v3/quotations → CourierQuote (pura). */
export function parseLalamoveQuote(raw: any, modal: CourierModal): CourierQuote {
  const d = raw?.data ?? {};
  const price = Number(d?.priceBreakdown?.total ?? 0);
  const distance = d?.distance?.value != null ? Number(d.distance.value) : undefined;
  // Lalamove dá distância em metros (unit "m") por padrão.
  const distanceKm = distance != null ? Math.round((distance / 1000) * 100) / 100 : undefined;
  return {
    provider: "lalamove",
    quotationId: d?.quotationId ? String(d.quotationId) : undefined,
    priceBRL: Number.isFinite(price) ? price : 0,
    modal,
    distanceKm,
    expiresAt: d?.expiresAt ? String(d.expiresAt) : undefined,
    raw,
  };
}

/** Monta o corpo do POST /v3/orders a partir de uma cotação já feita (pura). */
export function buildLalamoveOrderBody(input: CourierDispatchInput): Record<string, unknown> {
  const stops = (input.quote?.raw as any)?.data?.stops ?? [];
  const senderStopId = stops[0]?.stopId;
  const recipientStopId = stops[1]?.stopId;
  return {
    data: {
      quotationId: input.quote?.quotationId,
      sender: { stopId: senderStopId, name: input.sender.name, phone: input.sender.phone },
      recipients: [
        { stopId: recipientStopId, name: input.recipient.name, phone: input.recipient.phone, remarks: input.remarks ?? undefined },
      ],
      ...(input.orderRef ? { metadata: { orderRef: input.orderRef } } : {}),
    },
  };
}

/** Normaliza o status do Lalamove para o nosso conjunto. */
export function normalizeLalamoveStatus(s: string | undefined): CourierStatus["status"] {
  switch ((s ?? "").toUpperCase()) {
    case "ASSIGNING_DRIVER": return "pending";
    case "ON_GOING": return "assigned";
    case "PICKED_UP": return "picked_up";
    case "COMPLETED": return "delivered";
    case "CANCELED":
    case "EXPIRED":
    case "REJECTED": return "canceled";
    default: return "unknown";
  }
}

export class LalamoveCourier implements CourierConnector {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly market: string;
  private readonly baseUrl: string;

  constructor(creds?: { apiKey?: string; apiSecret?: string; market?: string; baseUrl?: string }) {
    this.apiKey = creds?.apiKey ?? process.env.LALAMOVE_API_KEY ?? "";
    this.apiSecret = creds?.apiSecret ?? process.env.LALAMOVE_API_SECRET ?? "";
    this.market = creds?.market ?? process.env.LALAMOVE_MARKET ?? "BR";
    const sandbox = (process.env.LALAMOVE_ENV ?? "sandbox").toLowerCase() !== "production";
    this.baseUrl = creds?.baseUrl ?? (sandbox ? SANDBOX : PROD);
  }

  private assertCreds() {
    if (!this.apiKey || !this.apiSecret) throw new Error("LalamoveCourier: faltam LALAMOVE_API_KEY/SECRET");
  }

  private headers(method: string, path: string, body: string): Record<string, string> {
    // Lalamove usa timestamp em ms; injetável por teste via _now (default Date.now).
    const timestamp = String(this._now());
    const signature = lalamoveSignature({ secret: this.apiSecret, timestamp, method, path, body });
    return {
      Authorization: `hmac ${this.apiKey}:${timestamp}:${signature}`,
      Market: this.market,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }
  // separado p/ permitir override em teste sem usar Date.now real
  protected _now(): number { return Date.now(); }

  private async send<T>(method: "POST" | "GET", path: string, body?: unknown): Promise<T> {
    this.assertCreds();
    const bodyStr = body != null ? JSON.stringify(body) : "";
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(method, path, bodyStr),
      ...(method === "POST" ? { body: bodyStr } : {}),
    });
    if (!res.ok) throw new Error(`Lalamove ${method} ${path} ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  async quoteCourier(input: CourierQuoteInput): Promise<CourierQuote> {
    const raw = await this.send<any>("POST", "/v3/quotations", buildLalamoveQuoteBody(input));
    return parseLalamoveQuote(raw, input.modal ?? "moto");
  }

  async dispatch(input: CourierDispatchInput): Promise<CourierDispatch> {
    const raw = await this.send<any>("POST", "/v3/orders", buildLalamoveOrderBody(input));
    const d = raw?.data ?? {};
    return {
      provider: "lalamove",
      deliveryId: String(d.orderId ?? d.id ?? ""),
      status: normalizeLalamoveStatus(d.status),
      priceBRL: d?.priceBreakdown?.total != null ? Number(d.priceBreakdown.total) : input.quote?.priceBRL,
      trackingUrl: d.shareLink ? String(d.shareLink) : undefined,
    };
  }

  async getStatus(deliveryId: string): Promise<CourierStatus> {
    const raw = await this.send<any>("GET", `/v3/orders/${deliveryId}`);
    const d = raw?.data ?? {};
    return {
      status: normalizeLalamoveStatus(d.status),
      rawStatus: d.status ? String(d.status) : undefined,
      driver: d.driverId ? { name: d.driverName, phone: d.driverPhone, plate: d.plateNumber } : undefined,
      updatedAt: d.updatedAt ? String(d.updatedAt) : undefined,
    };
  }
}
