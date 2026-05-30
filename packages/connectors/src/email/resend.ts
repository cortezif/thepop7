// Envio de e-mail transacional (Resend). Ativado por RESEND_API_KEY + EMAIL_FROM.
// Degrada graciosamente: se não configurado, sendEmail retorna { ok:false, skipped:true }.
// Docs: https://resend.com/docs/api-reference/emails/send-email

export type SendEmailInput = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
};

export function emailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(
  input: SendEmailInput,
): Promise<{ ok: boolean; id?: string; skipped?: boolean; error?: string }> {
  if (!emailConfigured()) return { ok: false, skipped: true };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html ?? (input.text ? `<pre style="font-family:inherit;white-space:pre-wrap">${input.text}</pre>` : undefined),
        reply_to: input.replyTo,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, error: `resend ${res.status}: ${err}` };
    }
    const data: any = await res.json();
    return { ok: true, id: data?.id };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/**
 * Constrói o endereço de resposta com plus-addressing pra captura inbound:
 * cotacao+<token>@<dominio>. Requer EMAIL_INBOUND_DOMAIN configurado.
 */
export function inboundReplyTo(token: string): string | undefined {
  const domain = process.env.EMAIL_INBOUND_DOMAIN;
  if (!domain) return undefined;
  return `cotacao+${token}@${domain}`;
}

/** Extrai o token de um endereço plus-addressing (cotacao+<token>@dominio). */
export function tokenFromAddress(address: string): string | null {
  const m = address.match(/cotacao\+([a-zA-Z0-9]+)@/i);
  return m ? m[1]! : null;
}
