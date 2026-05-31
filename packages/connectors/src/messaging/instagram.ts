import type { MessagingConnector } from "../types.js";
import { resolveCredential, credentialFromContext, type OutgoingMessage } from "@hubadvisor/shared";

// Docs: https://developers.facebook.com/docs/messenger-platform/instagram
// Requer: INSTAGRAM_ACCESS_TOKEN (Page Access Token com instagram_manage_messages)
// `msg.to` = PSID (page-scoped user ID) obtido no webhook de entrada da conversa.

const IG_API = "https://graph.facebook.com/v18.0";

export class InstagramMessaging implements MessagingConnector {
  async send(msg: OutgoingMessage): Promise<{ externalId: string }> {
    const accessToken = resolveCredential("instagram", "accessToken", "INSTAGRAM_ACCESS_TOKEN");

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

/** Verifica se as credenciais Instagram estão configuradas (contexto da loja ou env). */
export function instagramConfigured(): boolean {
  return !!(credentialFromContext("instagram", "accessToken") ?? process.env.INSTAGRAM_ACCESS_TOKEN);
}

/**
 * Busca o perfil público de quem mandou mensagem no Instagram (ADR-034) — nome e
 * @username — pra já cadastrar o cliente com nome real. Requer o IGSID (id do
 * remetente vindo no webhook) e o Page Access Token. Degrada pra null em erro
 * (não-fatal: o atendimento segue, a IA captura o nome na conversa).
 * Docs: https://developers.facebook.com/docs/messenger-platform/instagram/features/user-profile
 */
export async function fetchInstagramProfile(
  igsid: string, accessToken: string,
): Promise<{ name?: string; username?: string } | null> {
  if (!igsid || !accessToken) return null;
  try {
    const res = await fetch(`${IG_API}/${encodeURIComponent(igsid)}?fields=name,username&access_token=${accessToken}`);
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    if (!data || (!data.name && !data.username)) return null;
    return { name: data.name || undefined, username: data.username || undefined };
  } catch {
    return null;
  }
}
