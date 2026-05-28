import type { MessagingConnector } from "../types.js";
import type { OutgoingMessage } from "@thepop/shared";

// Docs: https://developers.facebook.com/docs/messenger-platform/instagram

export class InstagramMessaging implements MessagingConnector {
  async send(_msg: OutgoingMessage): Promise<{ externalId: string }> {
    throw new Error("InstagramMessaging.send not implemented — aguarda aprovação Meta");
  }
}
