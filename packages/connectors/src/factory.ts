import type {
  ErpConnector, LogisticsConnector, PaymentConnector,
  FiscalConnector, MessagingConnector
} from "./types.js";
import { MockErp }            from "./erp/mock-erp.js";
import { MockLogistics }      from "./logistics/mock-logistics.js";
import { MockPayment }        from "./payment/mock-payment.js";
import { MockFiscal }         from "./fiscal/mock-fiscal.js";
import { MockMessaging }      from "./messaging/mock-messaging.js";
import { BlingErp }           from "./erp/bling.js";
import { TrayErp }            from "./erp/tray.js";
import { MelhorEnvio }        from "./logistics/melhor-envio.js";
import { MercadoPago }        from "./payment/mercado-pago.js";
import { PlugNotas }          from "./fiscal/plug-notas.js";
import { CplugFiscal }        from "./fiscal/cplug.js";
import { WhatsappCloud, whatsappConfigured } from "./messaging/whatsapp-cloud.js";
import { InstagramMessaging, instagramConfigured } from "./messaging/instagram.js";
import { createFailover }     from "./failover.js";

const forceMocks = () => process.env.USE_MOCK_CONNECTORS === "true";
const log = (msg: string) => console.warn(msg);

// ──────────────────────────────────────────────────────────────────────────────
// Lógica de auto-detecção: se a credencial está presente → real; senão → mock.
// USE_MOCK_CONNECTORS=true força mocks independente das credenciais (útil em CI).
// ──────────────────────────────────────────────────────────────────────────────

export function erpProvider(): "tray" | "bling" {
  return (process.env.ERP_PROVIDER ?? "tray").toLowerCase() === "bling" ? "bling" : "tray";
}

export function getErpConnector(): ErpConnector {
  if (forceMocks()) return new MockErp();
  const primary: ErpConnector = erpProvider() === "bling" ? new BlingErp() : new TrayErp();
  return createFailover<ErpConnector>([primary, new MockErp()], { label: `erp:${erpProvider()}`, log });
}

export function buildErpForTenant(opts: {
  provider?: "tray" | "bling";
  trayCreds?: { apiUrl: string; accessToken: string } | null;
}): ErpConnector {
  if (forceMocks()) return new MockErp();
  const provider = opts.provider ?? erpProvider();
  if (provider === "bling") {
    return createFailover<ErpConnector>([new BlingErp(), new MockErp()], { label: "erp:bling", log });
  }
  const tray = opts.trayCreds ? new TrayErp(opts.trayCreds) : new TrayErp();
  return createFailover<ErpConnector>([tray, new MockErp()], { label: "erp:tray", log });
}

export function getLogisticsConnector(accessToken?: string): LogisticsConnector {
  if (forceMocks()) return new MockLogistics();
  const token = accessToken ?? process.env.MELHORENVIO_ACCESS_TOKEN ?? "";
  if (!token) return new MockLogistics();
  return createFailover<LogisticsConnector>(
    [new MelhorEnvio(token), new MockLogistics()],
    { label: "logistics:melhor-envio", log }
  );
}

export function getPaymentConnector(accessToken?: string): PaymentConnector {
  if (forceMocks()) return new MockPayment();
  const token = accessToken ?? process.env.MERCADOPAGO_ACCESS_TOKEN ?? "";
  if (!token) return new MockPayment();
  return createFailover<PaymentConnector>(
    [new MercadoPago(token), new MockPayment()],
    { label: "payment:mercadopago", log }
  );
}

export function fiscalProvider(): "cplug" | "plugnotas" {
  return (process.env.FISCAL_PROVIDER ?? "cplug").toLowerCase() === "plugnotas" ? "plugnotas" : "cplug";
}

export function getFiscalConnector(): FiscalConnector {
  if (forceMocks()) return new MockFiscal();
  const primary: FiscalConnector = fiscalProvider() === "plugnotas" ? new PlugNotas() : new CplugFiscal();
  return createFailover<FiscalConnector>([primary, new MockFiscal()], { label: `fiscal:${fiscalProvider()}`, log });
}

export function getMessagingConnector(channel?: "whatsapp" | "instagram"): MessagingConnector {
  if (forceMocks()) return new MockMessaging();
  if (channel === "instagram" || (!channel && instagramConfigured() && !whatsappConfigured())) {
    if (instagramConfigured()) return new InstagramMessaging();
  }
  if (whatsappConfigured()) return new WhatsappCloud();
  if (instagramConfigured()) return new InstagramMessaging();
  // Nenhuma credencial configurada — mock silencioso (não "engole": loga no console)
  return new MockMessaging();
}
