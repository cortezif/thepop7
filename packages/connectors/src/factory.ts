import type {
  ErpConnector, LogisticsConnector, PaymentConnector,
  FiscalConnector, MessagingConnector
} from "./types.js";
import { MockErp }       from "./erp/mock-erp.js";
import { MockLogistics } from "./logistics/mock-logistics.js";
import { MockPayment }   from "./payment/mock-payment.js";
import { MockFiscal }    from "./fiscal/mock-fiscal.js";
import { MockMessaging } from "./messaging/mock-messaging.js";
import { BlingErp }      from "./erp/bling.js";
import { MelhorEnvio }   from "./logistics/melhor-envio.js";
import { MercadoPago }   from "./payment/mercado-pago.js";
import { PlugNotas }     from "./fiscal/plug-notas.js";
import { WhatsappCloud } from "./messaging/whatsapp-cloud.js";
import { createFailover } from "./failover.js";

const useMocks = () => process.env.USE_MOCK_CONNECTORS !== "false";
const log = (msg: string) => console.warn(msg);

// Em produção, o provedor real é o primário e o mock é o último recurso:
// um outage do provedor degrada o serviço (resposta mock) em vez de derrubar
// o fluxo de venda/pós-venda (ADR-022). Em dev (mocks), connector único.

export function getErpConnector(): ErpConnector {
  if (useMocks()) return new MockErp();
  return createFailover<ErpConnector>([new BlingErp(), new MockErp()], { label: "erp", log });
}
export function getLogisticsConnector(): LogisticsConnector {
  if (useMocks()) return new MockLogistics();
  return createFailover<LogisticsConnector>([new MelhorEnvio(), new MockLogistics()], { label: "logistics", log });
}
export function getPaymentConnector(): PaymentConnector {
  if (useMocks()) return new MockPayment();
  return createFailover<PaymentConnector>([new MercadoPago(), new MockPayment()], { label: "payment", log });
}
export function getFiscalConnector(): FiscalConnector {
  if (useMocks()) return new MockFiscal();
  return createFailover<FiscalConnector>([new PlugNotas(), new MockFiscal()], { label: "fiscal", log });
}
export function getMessagingConnector(): MessagingConnector {
  // Messaging não cai pro mock: enviar pro mock "engoliria" a mensagem em silêncio.
  // Falha de envio deve aparecer (retry/handoff fica a cargo do chamador).
  return useMocks() ? new MockMessaging() : new WhatsappCloud();
}
