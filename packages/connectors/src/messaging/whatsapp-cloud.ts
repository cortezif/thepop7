import type { MessagingConnector } from "../types.js";
import type { OutgoingMessage } from "@thepop/shared";

const WA_API = "https://graph.facebook.com/v18.0";

export class WhatsappCloud implements MessagingConnector {
  async send(msg: OutgoingMessage): Promise<{ externalId: string }> {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN ?? "";

    if (!phoneNumberId || !accessToken) {
      throw new Error("WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_ACCESS_TOKEN não configurados");
    }

    const to = (msg.to ?? "").replace(/\D/g, "");
    if (!to) throw new Error("WhatsApp: msg.to ausente — inclua o telefone E.164 do destinatário");

    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
    };

    if (msg.type === "text" || !msg.type) {
      body.type = "text";
      body.text = { body: msg.text ?? "", preview_url: false };
    } else if (msg.type === "image" && msg.mediaUrl) {
      body.type = "image";
      body.image = { link: msg.mediaUrl };
    } else if (msg.type === "template" && msg.templateName) {
      body.type = "template";
      body.template = {
        name: msg.templateName,
        language: { code: "pt_BR" },
        components: msg.templateParams
          ? [{ type: "body", parameters: Object.values(msg.templateParams).map((v) => ({ type: "text", text: v })) }]
          : [],
      };
    } else {
      body.type = "text";
      body.text = { body: msg.text ?? "", preview_url: false };
    }

    const res = await fetch(`${WA_API}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`WhatsApp.send ${res.status}: ${JSON.stringify(err)}`);
    }

    const data: any = await res.json();
    return { externalId: data.messages?.[0]?.id ?? "wamid.unknown" };
  }
}

/** Verifica se as credenciais WhatsApp estão configuradas. */
export function whatsappConfigured(): boolean {
  return !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}
