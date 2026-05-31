import type { SmsConnector } from "../types.js";

// SMS mock (dev/sem credencial). Loga e devolve ok — permite exercitar o broadcast.
export class MockSms implements SmsConnector {
  async send(input: { to: string; text: string }): Promise<{ ok: boolean; externalId?: string; skipped?: boolean }> {
    // eslint-disable-next-line no-console
    console.log(`[MockSms] → ${input.to}: ${input.text.slice(0, 60)}`);
    return { ok: true, externalId: "mock-sms-" + input.to.slice(-4), skipped: true };
  }
}
