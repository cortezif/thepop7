import type { MessagingConnector } from "../types.js";
import type { OutgoingMessage } from "@thepop/shared";

// Docs: https://developers.facebook.com/docs/messenger-platform/instagram
// Requer: INSTAGRAM_ACCESS_TOKEN (Page Access Token com instagram_manage_messages)
// `msg.to` = PSID (page-scoped user ID) obtido no webhook de entrada da conversa.

const IG_API = "https://graph.facebook.com/v18.0";

export class InstagramMessaging implements MessagingConnector {
  async send(msg: OutgoingMessage): Promise<{ externalId: string }> {
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN ?? "";

    if (!accessToken) {
      throw new Error("INSTAGRAM_ACCESS_TOKEN não configurado");
    }

    const recipientId = msg.to ?? "";
    if (!recipientId) throw new Error("Instagram: msg.to ausente — inclua o PSID do destinatário");

    const body: Record<string, unknown> = {
      recipient: { id: recipientId },
    };

    if (msg.type === "image" && msg.mediaUrl) {
      body.message = { attachment: { type: "image", payload: { url: msg.mediaUrl, is_reusable: false } } };
    } else {
      body.message = { text: msg.text ?? "" };
    }

    const res = await fetch(`${IG_API}/me/messages?access_token=${accessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Instagram.send ${res.status}: ${JSON.stringify(err)}`);
    }

    const data: any = await res.json();
    return { externalId: data.message_id ?? "ig.unknown" };
  }
}

/** Verifica se as credenciais Instagram estão configuradas. */
export function instagramConfigured(): boolean {
  return !!(process.env.INSTAGRAM_ACCESS_TOKEN);
}
