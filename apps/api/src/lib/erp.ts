import { erpProvider } from "@hubadvisor/connectors";
import { getTrayCreds, getBlingCreds } from "@hubadvisor/db";

// Resolve a credencial de ERP da loja conforme o provider ativo (ERP_PROVIDER).
// Busca SÓ a credencial do provider em uso (sem query desnecessária ao outro).
// Usado por catalog-sync, /products/:id e o agente (conversation-service).
export async function resolveErpCreds(tenantId: string): Promise<{
  provider: "tray" | "bling";
  trayCreds: { apiUrl: string; accessToken: string } | null;
  blingCreds: { accessToken: string } | null;
  connected: boolean;
}> {
  const provider = erpProvider();
  const trayCreds = provider === "tray" ? await getTrayCreds(tenantId) : null;
  const blingCreds = provider === "bling" ? await getBlingCreds(tenantId) : null;
  const connected = provider === "bling" ? !!blingCreds : !!trayCreds;
  return { provider, trayCreds, blingCreds, connected };
}
