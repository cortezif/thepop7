import { erpProvider } from "@hubadvisor/connectors";
import { getTrayCreds, getBlingCreds } from "@hubadvisor/db";
import { getOmieCreds } from "../services/integration-service.js";

// Resolve a credencial de ERP da loja conforme o provider ativo (ERP_PROVIDER).
// Busca SÓ a credencial do provider em uso (sem query desnecessária aos outros).
// Usado por catalog-sync, /products/:id e o agente (conversation-service).
export async function resolveErpCreds(tenantId: string): Promise<{
  provider: "tray" | "bling" | "omie";
  trayCreds: { apiUrl: string; accessToken: string } | null;
  blingCreds: { accessToken: string } | null;
  omieCreds: { appKey: string; appSecret: string } | null;
  connected: boolean;
}> {
  const provider = erpProvider();
  const trayCreds = provider === "tray" ? await getTrayCreds(tenantId) : null;
  const blingCreds = provider === "bling" ? await getBlingCreds(tenantId) : null;
  const omieCreds = provider === "omie" ? await getOmieCreds(tenantId) : null;
  const connected = provider === "bling" ? !!blingCreds : provider === "omie" ? !!omieCreds : !!trayCreds;
  return { provider, trayCreds, blingCreds, omieCreds, connected };
}
