import type { LogisticsConnector, QuoteInput, ShipmentInput, TrackingStatus } from "../types.js";
import type { ShippingQuote } from "@hubadvisor/shared";

const ME_API = "https://melhorenvio.com.br/api/v2/me";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "HubAdvisor/1.0 (suporte@hubadvisor.app)",
  };
}

export class MelhorEnvio implements LogisticsConnector {
  private token: string;

  constructor(accessToken?: string) {
    this.token = accessToken ?? process.env.MELHORENVIO_ACCESS_TOKEN ?? "";
  }

  async quote(input: QuoteInput): Promise<ShippingQuote[]> {
    if (!this.token) throw new Error("MELHORENVIO_ACCESS_TOKEN não configurado");

    const fromZip = input.fromZip.replace(/\D/g, "");
    const toZip = input.toZip.replace(/\D/g, "");
    const totalValue = input.items.reduce((s, i) => s + i.valueBRL, 0);

    const body = {
      from: { postal_code: fromZip },
      to: { postal_code: toZip },
      products: input.items.map((item, i) => ({
        id: String(i + 1),
        width: Math.max(1, Math.round(item.widthCm)),
        height: Math.max(1, Math.round(item.heightCm)),
        length: Math.max(1, Math.round(item.lengthCm)),
        weight: Math.max(0.1, item.weightG / 1000),
        insurance_value: item.valueBRL,
        quantity: 1,
      })),
      options: {
        insurance_value: totalValue,
        receipt: false,
        own_hand: false,
      },
      services: "",
    };

    const res = await fetch(`${ME_API}/shipment/calculate`, {
      method: "POST",
      headers: headers(this.token),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`MelhorEnvio.quote ${res.status}`);

    const data = await res.json() as any[];
    return data
      .filter((s: any) => !s.error && s.price != null)
      .map((s: any) => ({
        carrier: s.company?.name ?? s.name,
        service: s.name,
        priceBRL: Number(s.price),
        deliveryDays: s.delivery_time ?? s.delivery_range?.max ?? null,
        trackable: true,
      }));
  }

  async createShipment(_input: ShipmentInput): Promise<{ trackingCode: string; labelUrl: string }> {
    if (!this.token) throw new Error("MELHORENVIO_ACCESS_TOKEN não configurado");
    // Fluxo completo: cart → checkout → generate (3 passos, requer saldo na carteira ME)
    // Para MVP: use o painel do Melhor Envio pra gerar etiquetas após a cotação automática.
    throw new Error("Geração de etiqueta via API requer saldo na carteira Melhor Envio — use o painel ME para isso.");
  }

  async track(trackingCode: string): Promise<TrackingStatus[]> {
    if (!this.token) throw new Error("MELHORENVIO_ACCESS_TOKEN não configurado");

    const res = await fetch(`${ME_API}/shipment/tracking`, {
      method: "POST",
      headers: headers(this.token),
      body: JSON.stringify({ orders: [trackingCode] }),
    });
    if (!res.ok) return [{ status: "unknown", description: "Rastreio não disponível", timestamp: new Date().toISOString() }];

    const data: any = await res.json();
    const tracking = data[trackingCode];
    if (!tracking?.tracking) return [];

    return (tracking.tracking as any[]).map((t: any) => ({
      status: t.status ?? "in_transit",
      description: t.message ?? t.description ?? "",
      location: t.location ?? undefined,
      timestamp: t.created_at ?? new Date().toISOString(),
    }));
  }
}

/** Credenciais do app Melhor Envio. Param tem prioridade sobre env. */
export type MeAppCreds = { clientId?: string; clientSecret?: string };
const meId = (c?: MeAppCreds) => c?.clientId ?? process.env.MELHORENVIO_CLIENT_ID ?? "";
const meSecret = (c?: MeAppCreds) => c?.clientSecret ?? process.env.MELHORENVIO_CLIENT_SECRET ?? "";

/** Troca o code OAuth por tokens Melhor Envio. */
export async function exchangeMeCode(opts: {
  code: string;
  redirectUri: string;
  creds?: MeAppCreds;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await fetch("https://melhorenvio.com.br/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: meId(opts.creds),
      client_secret: meSecret(opts.creds),
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`ME OAuth ${res.status}: ${JSON.stringify(err)}`);
  }
  const data: any = await res.json();
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in ?? 2592000 };
}

export async function refreshMeToken(refreshToken: string, creds?: MeAppCreds): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await fetch("https://melhorenvio.com.br/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: meId(creds),
      client_secret: meSecret(creds),
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`ME refresh ${res.status}`);
  const data: any = await res.json();
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in ?? 2592000 };
}

export function buildMeAuthorizeUrl(redirectUri: string, state: string, clientId?: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId ?? process.env.MELHORENVIO_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    scope: "cart-read cart-write shipping-calculate shipping-generate shipping-tracking orders-read orders-create",
    state,
  });
  return `https://melhorenvio.com.br/oauth/authorize?${params}`;
}
