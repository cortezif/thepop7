// Interfaces estáveis para todos os connectors externos.
// Trocar de provedor = trocar implementação. App não muda.

import type { OutgoingMessage, ProductSummary, ShippingQuote } from "@hubadvisor/shared";

// ============================================================
// ERP (catálogo, estoque, pedidos)
// ============================================================
export interface ErpConnector {
  listProducts(opts?: { limit?: number; updatedSince?: Date }): Promise<ErpProduct[]>;
  getProduct(externalId: string): Promise<ErpProduct | null>;
  getStock(sku: string): Promise<number>;
  createOrder(order: ErpOrderInput): Promise<{ externalId: string }>;
  cancelOrder(externalId: string, reason: string): Promise<void>;
}

export type ErpProduct = {
  externalId: string;
  name: string;
  description?: string;
  priceBRL: number;
  costBRL?: number;
  variants: Array<{
    sku: string;
    color?: string;
    size?: string;
    stock: number;
    barcode?: string; // GTIN/EAN da variante, quando o ERP fornece
  }>;
  photos: string[];
  // Medidas reais por tamanho (ADR-006): { "M": { bust, waist, hips, length } } em cm
  measurements?: Record<string, { bust?: number; waist?: number; hips?: number; length?: number }>;
};

export type ErpOrderInput = {
  contactPhone?: string;
  contactName?: string;
  items: Array<{ sku: string; quantity: number; unitPriceBRL: number }>;
  shippingZip: string;
  shippingAddress: Record<string, string>;
  totalBRL: number;
};

// ============================================================
// LOGÍSTICA (frete + etiqueta + rastreio)
// ============================================================
export interface LogisticsConnector {
  quote(input: QuoteInput): Promise<ShippingQuote[]>;
  createShipment(input: ShipmentInput): Promise<{ trackingCode: string; labelUrl: string }>;
  track(trackingCode: string): Promise<TrackingStatus[]>;
}

export type QuoteInput = {
  fromZip: string;
  toZip: string;
  items: Array<{ weightG: number; widthCm: number; heightCm: number; lengthCm: number; valueBRL: number }>;
};

export type ShipmentInput = {
  orderExternalId: string;
  fromZip: string;
  toZip: string;
  toAddress: Record<string, string>;
  service: string; // PAC, Sedex, etc.
  carrier: string;
};

export type TrackingStatus = {
  status: string;
  description: string;
  location?: string;
  timestamp: string; // ISO
};

// ============================================================
// COURIER / ENTREGA SOB DEMANDA (ADR-030 — entregador on-demand)
// Modelo distinto da LogisticsConnector (encomenda/transportadora): aqui a
// entrega é uma corrida com coordenadas, modal (moto/carro) e ETA em minutos.
// Implementações: Lalamove (metrô, com sandbox), Open Delivery/ABRASEL
// (Pedidos10 etc. — interior), e MockCourier (dev sem credencial).
// ============================================================
export interface CourierConnector {
  quoteCourier(input: CourierQuoteInput): Promise<CourierQuote>;
  dispatch(input: CourierDispatchInput): Promise<CourierDispatch>;
  getStatus(deliveryId: string): Promise<CourierStatus>;
}

export type GeoPoint = { lat: number; lng: number; address?: string };
export type CourierModal = "moto" | "carro";

export type CourierQuoteInput = {
  pickup: GeoPoint;
  dropoff: GeoPoint;
  modal?: CourierModal;     // default: decidido pelo provider/loja (volume)
  itemsValueBRL?: number;   // valor declarado (seguro)
  remarks?: string;
};

export type CourierQuote = {
  provider: string;
  quotationId?: string;     // alguns providers exigem na hora do dispatch
  priceBRL: number;
  modal: CourierModal;
  etaMinutes?: number;
  distanceKm?: number;
  expiresAt?: string;       // ISO; cotações expiram (ex.: Lalamove 5 min)
  raw?: unknown;
};

export type CourierContact = { name: string; phone: string };
export type CourierDispatchInput = {
  quote?: CourierQuote;     // reaproveita a cotação quando o provider exige
  pickup: GeoPoint;
  dropoff: GeoPoint;
  modal?: CourierModal;
  sender: CourierContact;
  recipient: CourierContact;
  orderRef?: string;        // id do nosso pedido
  remarks?: string;
};

export type CourierDispatch = {
  provider: string;
  deliveryId: string;
  status: string;
  priceBRL?: number;
  trackingUrl?: string;
};

export type CourierStatus = {
  status: string;           // normalizado: pending|assigned|picked_up|on_the_way|delivered|canceled|unknown
  rawStatus?: string;
  driver?: { name?: string; phone?: string; plate?: string };
  location?: GeoPoint;
  updatedAt?: string;
};

// ============================================================
// SMS (broadcast de promoções — ADR-031)
// ============================================================
export interface SmsConnector {
  send(input: { to: string; text: string }): Promise<{ ok: boolean; externalId?: string; skipped?: boolean; error?: string }>;
}

// ============================================================
// PAGAMENTO
// ============================================================
export interface PaymentConnector {
  createCharge(input: ChargeInput): Promise<ChargeResult>;
  getCharge(externalId: string): Promise<ChargeStatus>;
  refund(externalId: string, amountBRL?: number): Promise<{ refundId: string }>;
}

export type ChargeInput = {
  amountBRL: number;
  description: string;
  method: "pix" | "card" | "boleto";
  customer: { name: string; document?: string; email?: string; phone?: string };
  externalReference: string; // ID do pedido nosso
  expiresInMinutes?: number;
};

export type ChargeResult = {
  externalId: string;
  status: "pending" | "approved" | "rejected";
  pixQrCode?: string;       // string copia-cola
  pixQrCodeBase64?: string; // imagem
  paymentLink?: string;     // cartão / boleto
  boletoLine?: string;
  expiresAt?: string;
};

export type ChargeStatus = {
  externalId: string;
  status: "pending" | "approved" | "rejected" | "refunded";
  paidAt?: string;
};

// ============================================================
// FISCAL (NFe)
// ============================================================
export interface FiscalConnector {
  issueNfe(input: NfeInput): Promise<NfeResult>;
}

export type NfeInput = {
  orderId: string;
  customer: { name: string; document: string; email?: string; address: Record<string, string> };
  items: Array<{ description: string; sku: string; quantity: number; unitPriceBRL: number; ncm?: string; cfop?: string; barcode?: string }>;
  totalBRL: number;
};

export type NfeResult = {
  number: string;
  xmlUrl: string;
  pdfUrl: string;
};

// ============================================================
// MESSAGING (canais de mensagem)
// ============================================================
export interface MessagingConnector {
  send(msg: OutgoingMessage): Promise<{ externalId: string }>;
}

// ============================================================
// ADS / MÍDIA PAGA (ADR-028 — Theo). Meta Marketing API.
// ============================================================
export interface AdsConnector {
  createCampaign(input: AdCampaignInput): Promise<{ externalId: string; status: string }>;
  setStatus(externalId: string, status: "ativa" | "pausada"): Promise<{ ok: boolean }>;
  getInsights(externalId: string): Promise<AdInsights>;
}

export type AdCampaignInput = {
  name: string;
  objective: "mensagens" | "trafego" | "vendas" | "reconhecimento";
  dailyBudgetBRL: number;
  audience?: { label?: string; definition?: Record<string, unknown> };
  creative?: { headline?: string; primaryText?: string; cta?: string; imageUrl?: string };
};

export type AdInsights = {
  impressions: number;
  clicks: number;
  spendBRL: number;
  conversions: number;
  ctr: number;   // 0..1
  roas: number;  // retorno sobre investimento
};
