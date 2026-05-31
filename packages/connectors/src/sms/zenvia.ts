import type { SmsConnector } from "../types.js";

// SMS via Zenvia (provedor brasileiro). API v2.
// Docs: https://zenvia.github.io/zenvia-openapi-spec/v2/  (channels/sms/messages)
// Auth: header X-API-TOKEN. Degrada gracioso: sem credencial → skipped.
//
// Body de envio (pura, testável): { from, to, contents: [{ type:"text", text }] }.

const ZENVIA_URL = "https://api.zenvia.com/v2/channels/sms/messages";

export function zenviaConfigured(): boolean {
  return !!process.env.ZENVIA_TOKEN && !!process.env.ZENVIA_FROM;
}

/** Corpo do POST de SMS da Zenvia (pura). */
export function buildZenviaBody(from: string, to: string, text: string): Record<string, unknown> {
  return { from, to, contents: [{ type: "text", text }] };
}

export class ZenviaSms implements SmsConnector {
  private readonly token: string;
  private readonly from: string;

  constructor(creds?: { token?: string; from?: string }) {
    this.token = creds?.token ?? process.env.ZENVIA_TOKEN ?? "";
    this.from = creds?.from ?? process.env.ZENVIA_FROM ?? "";
  }

  async send(input: { to: string; text: string }): Promise<{ ok: boolean; externalId?: string; skipped?: boolean; error?: string }> {
    if (!this.token || !this.from) return { ok: false, skipped: true };
    try {
      const res = await fetch(ZENVIA_URL, {
        method: "POST",
        headers: { "X-API-TOKEN": this.token, "Content-Type": "application/json" },
        body: JSON.stringify(buildZenviaBody(this.from, input.to, input.text)),
      });
      if (!res.ok) return { ok: false, error: `zenvia ${res.status}: ${await res.text().catch(() => "")}` };
      const data: any = await res.json().catch(() => ({}));
      return { ok: true, externalId: data?.id ? String(data.id) : undefined };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  }
}
