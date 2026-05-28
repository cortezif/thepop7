import type { MessagingConnector } from "../types.js";
import type { OutgoingMessage } from "@thepop/shared";

// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/
// Requer: META_APP_ID, META_APP_SECRET, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN

export class WhatsappCloud implements MessagingConnector {
  async send(_msg: OutgoingMessage): Promise<{ externalId: string }> {
    throw new Error("WhatsappCloud.send not implemented — aguarda aprovação Meta");
  }
}
