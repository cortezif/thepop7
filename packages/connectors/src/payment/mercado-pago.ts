import type { PaymentConnector, ChargeInput, ChargeResult, ChargeStatus } from "../types.js";

const MP_API = "https://api.mercadopago.com";

export class MercadoPago implements PaymentConnector {
  private token: string;

  constructor(accessToken?: string) {
    this.token = accessToken ?? process.env.MERCADOPAGO_ACCESS_TOKEN ?? "";
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
    if (idempotencyKey) h["X-Idempotency-Key"] = idempotencyKey;
    return h;
  }

  async createCharge(input: ChargeInput): Promise<ChargeResult> {
    if (!this.token) throw new Error("MERCADOPAGO_ACCESS_TOKEN não configurado");

    const expiresAt = new Date(Date.now() + (input.expiresInMinutes ?? 30) * 60_000).toISOString();
    const body = {
      transaction_amount: Number(input.amountBRL.toFixed(2)),
      description: input.description,
      payment_method_id: "pix",
      payer: {
        email: input.customer.email ?? `pedido-${input.externalReference}@hubadvisor.app`,
        first_name: input.customer.name.split(" ")[0] ?? input.customer.name,
        last_name: input.customer.name.split(" ").slice(1).join(" ") || ".",
      },
      date_of_expiration: expiresAt,
      external_reference: input.externalReference,
      notification_url: process.env.APP_PUBLIC_URL
        ? `${process.env.APP_PUBLIC_URL}/api/webhooks/mercadopago`
        : undefined,
    };

    const res = await fetch(`${MP_API}/v1/payments`, {
      method: "POST",
      headers: this.headers(`thepop-${input.externalReference}`),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`MercadoPago.createCharge ${res.status}: ${JSON.stringify(err)}`);
    }

    const data: any = await res.json();
    const txData = data.point_of_interaction?.transaction_data;

    return {
      externalId: String(data.id),
      status: data.status === "approved" ? "approved" : data.status === "rejected" ? "rejected" : "pending",
      pixQrCode: txData?.qr_code,
      pixQrCodeBase64: txData?.qr_code_base64
        ? `data:image/png;base64,${txData.qr_code_base64}`
        : undefined,
      expiresAt: data.date_of_expiration ?? expiresAt,
    };
  }

  async getCharge(externalId: string): Promise<ChargeStatus> {
    if (!this.token) throw new Error("MERCADOPAGO_ACCESS_TOKEN não configurado");

    const res = await fetch(`${MP_API}/v1/payments/${externalId}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`MercadoPago.getCharge ${res.status}`);

    const data: any = await res.json();
    const status: ChargeStatus["status"] =
      data.status === "approved" ? "approved"
      : data.status === "refunded" || data.status === "charged_back" ? "refunded"
      : data.status === "cancelled" || data.status === "rejected" ? "rejected"
      : "pending";

    return { externalId: String(data.id), status, paidAt: data.date_approved ?? undefined };
  }

  async refund(externalId: string, amountBRL?: number): Promise<{ refundId: string }> {
    if (!this.token) throw new Error("MERCADOPAGO_ACCESS_TOKEN não configurado");

    const body = amountBRL != null ? { amount: Number(amountBRL.toFixed(2)) } : {};
    const res = await fetch(`${MP_API}/v1/payments/${externalId}/refunds`, {
      method: "POST",
      headers: this.headers(`refund-${externalId}`),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`MercadoPago.refund ${res.status}`);

    const data: any = await res.json();
    return { refundId: String(data.id) };
  }
}

/** Troca o code OAuth por access_token + refresh_token. */
export async function exchangeMpCode(opts: {
  code: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken: string; userId: string; expiresIn: number }> {
  const res = await fetch(`${MP_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: process.env.MERCADOPAGO_APP_ID ?? "",
      client_secret: process.env.MERCADOPAGO_APP_SECRET ?? "",
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`MP OAuth ${res.status}: ${JSON.stringify(err)}`);
  }
  const data: any = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    userId: String(data.user_id),
    expiresIn: data.expires_in ?? 15552000,
  };
}

export async function refreshMpToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await fetch(`${MP_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: process.env.MERCADOPAGO_APP_ID ?? "",
      client_secret: process.env.MERCADOPAGO_APP_SECRET ?? "",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`MP refresh ${res.status}`);
  const data: any = await res.json();
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in ?? 15552000 };
}

export function buildMpAuthorizeUrl(redirectUri: string, state: string): string {
  const appId = process.env.MERCADOPAGO_APP_ID ?? "";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: appId,
    redirect_uri: redirectUri,
    state,
  });
  return `https://auth.mercadopago.com.br/authorization?${params}`;
}
