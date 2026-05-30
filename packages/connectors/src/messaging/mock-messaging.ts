import type { MessagingConnector } from "../types.js";
import type { OutgoingMessage } from "@hubadvisor/shared";

export class MockMessaging implements MessagingConnector {
  async send(msg: OutgoingMessage): Promise<{ externalId: string }> {
    const externalId = "mock-msg-" + Date.now();
    // Mock: imprime no log pra inspeção em desenvolvimento
    // eslint-disable-next-line no-console
    console.log(`[MockMessaging] → ${msg.type} → conversa ${msg.conversationId}:`, msg.text ?? msg.mediaUrl ?? msg.templateName);
    return { externalId };
  }
}
