import type {
  ErpConnector, LogisticsConnector, PaymentConnector,
  FiscalConnector, MessagingConnector, CourierConnector
} from "./types.js";
import { MockErp }            from "./erp/mock-erp.js";
import { MockLogistics }      from "./logistics/mock-logistics.js";
import { MockPayment }        from "./payment/mock-payment.js";
import { MockFiscal }         from "./fiscal/mock-fiscal.js";
import { MockMessaging }      from "./messaging/mock-messaging.js";
import { BlingErp }           from "./erp/bling.js";
import { OmieErp }            from "./erp/omie.js";
import { TrayErp }            from "./erp/tray.js";
import { MelhorEnvio }        from "./logistics/melhor-envio.js";
import { LalamoveCourier }    from "./courier/lalamove.js";
import { OpenDeliveryCourier } from "./courier/open-delivery.js";
import { MockCourier }        from "./courier/mock-courier.js";
import { MercadoPago }        from "./payment/mercado-pago.js";
import { PlugNotas }          from "./fiscal/plug-notas.js";
import { CplugFiscal }        from "./fiscal/cplug.js";
import { WhatsappCloud, whatsappConfigured } from "./messaging/whatsapp-cloud.js";
import { InstagramMessaging, instagramConfigured } from "./messaging/instagram.js";
import { MetaAds, MockAds, metaAdsConfigured } from "./ads/meta-ads.js";
import { createFailover }     from "./failover.js";
import type { AdsConnector } from "./types.js";

const forceMocks = () => process.env.USE_MOCK_CONNECTORS === "true";
const log = (msg: string) => console.warn(msg);

// ──────────────────────────────────────────────────────────────────────────────
// Lógica de auto-detecção: se a credencial está presente → real; senão → mock.
// USE_MOCK_CONNECTORS=true força mocks independente das credenciais (útil em CI).
// ──────────────────────────────────────────────────────────────────────────────

export function erpProvider(): "tray" | "bling" | "omie" {
  const p = (process.env.ERP_PROVIDER ?? "tray").toLowerCase();
  return p === "bling" ? "bling" : p === "omie" ? "omie" : "tray";
}

export function getErpConnector(): ErpConnector {
  if (forceMocks()) return new MockErp();
  const p = erpProvider();
  const primary: ErpConnector = p === "bling" ? new BlingErp() : p === "omie" ? new OmieErp() : new TrayErp();
  return createFailover<ErpConnector>([primary, new MockErp()], { label: `erp:${p}`, log });
}

export function buildErpForTenant(opts: {
  provider?: "tray" | "bling" | "omie";
  trayCreds?: { apiUrl: string; accessToken: string } | null;
  blingCreds?: { accessToken: string } | null;
  omieCreds?: { appKey: string; appSecret: string } | null;
}): ErpConnector {
  if (forceMocks()) return new MockErp();
  const provider = opts.provider ?? erpProvider();
  if (provider === "bling") {
    const bling = opts.blingCreds ? new BlingErp(opts.blingCreds) : new BlingErp();
    return createFailover<ErpConnector>([bling, new MockErp()], { label: "erp:bling", log });
  }
  if (provider === "omie") {
    const omie = opts.omieCreds ? new OmieErp(opts.omieCreds) : new OmieErp();
    return createFailover<ErpConnector>([omie, new MockErp()], { label: "erp:omie", log });
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

// ── COURIER / entrega sob demanda (ADR-030) ──────────────────────────────────
export function courierProvider(): "lalamove" | "opendelivery" {
  return (process.env.COURIER_PROVIDER ?? "lalamove").toLowerCase() === "opendelivery" ? "opendelivery" : "lalamove";
}

export function getCourierConnector(): CourierConnector {
  if (forceMocks()) return new MockCourier();
  const provider = courierProvider();
  if (provider === "opendelivery") {
    const configured = !!process.env.OPENDELIVERY_CLIENT_ID && !!process.env.OPENDELIVERY_BASE_URL;
    if (!configured) return new MockCourier();
    return createFailover<CourierConnector>([new OpenDeliveryCourier(), new MockCourier()], { label: "courier:opendelivery", log });
  }
  const configured = !!process.env.LALAMOVE_API_KEY && !!process.env.LALAMOVE_API_SECRET;
  if (!configured) return new MockCourier();
  return createFailover<CourierConnector>([new LalamoveCourier(), new MockCourier()], { label: "courier:lalamove", log });
}

/** Constrói o courier para um tenant (credencial por loja, do onboarding). */
export function buildCourierForTenant(opts: {
  provider?: "lalamove" | "opendelivery";
  lalamoveCreds?: { apiKey: string; apiSecret: string; market?: string } | null;
  openDeliveryCreds?: { clientId: string; clientSecret: string; baseUrl: string } | null;
}): CourierConnector {
  if (forceMocks()) return new MockCourier();
  const provider = opts.provider ?? courierProvider();
  if (provider === "opendelivery") {
    if (!opts.openDeliveryCreds) return new MockCourier();
    return createFailover<CourierConnector>([new OpenDeliveryCourier(opts.openDeliveryCreds), new MockCourier()], { label: "courier:opendelivery", log });
  }
  if (!opts.lalamoveCreds) return new MockCourier();
  return createFailover<CourierConnector>([new LalamoveCourier(opts.lalamoveCreds), new MockCourier()], { label: "courier:lalamove", log });
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

export function getAdsConnector(): AdsConnector {
  if (forceMocks()) return new MockAds();
  return metaAdsConfigured() ? new MetaAds() : new MockAds();
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
