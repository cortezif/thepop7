import type {
  CourierConnector, CourierQuoteInput, CourierQuote,
  CourierDispatchInput, CourierDispatch, CourierStatus, CourierModal,
} from "../types.js";

// Open Delivery (padrão ABRASEL) — operador logístico. Pedidos10, Foody e outros
// implementam este padrão, então UM conector cobre vários provedores (inclusive
// interior, via Pedidos10). Docs: https://abrasel-nacional.github.io/opendelivery/
//
// Auth: OAuth2 client_credentials → {baseUrl}/oauth/token (token ~6h).
// Logística: {baseUrl}/v1/logistics/availability (cotação/taxa),
//            {baseUrl}/v1/logistics/orderPicked/{id}, /finishDelivery/{id} + webhooks.
//
// ESTADO: a auth e o endpoint de availability estão wired; os CAMPOS exatos do
// payload de availability/dispatch dependem de homologação ABRASEL (sem sandbox
// público). Por isso `dispatch`/`getStatus` falham de forma EXPLÍCITA até serem
// confirmados contra a spec/credencial real — não enviamos payload adivinhado.

export function parseOpenDeliveryAvailability(raw: any, modal: CourierModal): CourierQuote {
  // Tolerante a variações: tenta os campos mais prováveis do padrão.
  const fee = raw?.deliveryFee?.value ?? raw?.fee ?? raw?.price ?? raw?.total ?? 0;
  const eta = raw?.estimatedDeliveryTime ?? raw?.eta ?? raw?.deliveryTimeMinutes;
  return {
    provider: "opendelivery",
    priceBRL: Number(fee) || 0,
    modal,
    etaMinutes: eta != null ? Number(eta) : undefined,
    raw,
  };
}

export class OpenDeliveryCourier implements CourierConnector {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(creds?: { clientId?: string; clientSecret?: string; baseUrl?: string }) {
    this.clientId = creds?.clientId ?? process.env.OPENDELIVERY_CLIENT_ID ?? "";
    this.clientSecret = creds?.clientSecret ?? process.env.OPENDELIVERY_CLIENT_SECRET ?? "";
    this.baseUrl = (creds?.baseUrl ?? process.env.OPENDELIVERY_BASE_URL ?? "").replace(/\/$/, "");
  }

  private assertCreds() {
    if (!this.clientId || !this.clientSecret || !this.baseUrl) {
      throw new Error("OpenDeliveryCourier: faltam OPENDELIVERY_CLIENT_ID/SECRET/BASE_URL");
    }
  }

  /** OAuth2 client_credentials, com cache simples do token. */
  private async accessToken(): Promise<string> {
    this.assertCreds();
    if (this.token && this.token.expiresAt > this._now() + 30_000) return this.token.value;
    const res = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.clientId, client_secret: this.clientSecret }),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || !json.access_token) throw new Error(`Open Delivery /oauth/token ${res.status}: ${JSON.stringify(json)}`);
    const ttl = (Number(json.expires_in) || 21600) * 1000;
    this.token = { value: String(json.access_token), expiresAt: this._now() + ttl };
    return this.token.value;
  }

  protected _now(): number { return Date.now(); }

  async quoteCourier(input: CourierQuoteInput): Promise<CourierQuote> {
    const token = await this.accessToken();
    // NOTA: campos do body a confirmar na homologação ABRASEL.
    const body = {
      pickup: { latitude: input.pickup.lat, longitude: input.pickup.lng, address: input.pickup.address },
      delivery: { latitude: input.dropoff.lat, longitude: input.dropoff.lng, address: input.dropoff.address },
      orderValue: input.itemsValueBRL,
    };
    const res = await fetch(`${this.baseUrl}/v1/logistics/availability`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Open Delivery availability ${res.status}: ${await res.text()}`);
    return parseOpenDeliveryAvailability(await res.json(), input.modal ?? "moto");
  }

  async dispatch(_input: CourierDispatchInput): Promise<CourierDispatch> {
    throw new Error("OpenDeliveryCourier.dispatch: pendente de homologação ABRASEL (payload de criação a confirmar)");
  }

  async getStatus(_deliveryId: string): Promise<CourierStatus> {
    throw new Error("OpenDeliveryCourier.getStatus: pendente de homologação ABRASEL (mapear eventos de webhook)");
  }
}
