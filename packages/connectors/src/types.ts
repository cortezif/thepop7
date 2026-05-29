// Interfaces estáveis para todos os connectors externos.
// Trocar de provedor = trocar implementação. App não muda.

import type { OutgoingMessage, ProductSummary, ShippingQuote } from "@thepop/shared";

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
