// Tipos compartilhados entre apps. Reflexo do schema Prisma, sem depender dele
// diretamente (apps/web não importa Prisma).

export type Channel = "whatsapp" | "instagram" | "manual";

export type IncomingMessage = {
  tenantId: string;
  channel: Channel;
  externalConversationId: string;
  externalMessageId: string;
  from: {
    phone?: string;
    igHandle?: string;
    name?: string;
  };
  type: "text" | "image" | "video" | "audio" | "document";
  text?: string;
  mediaUrl?: string;
  receivedAt: string; // ISO
};

export type OutgoingMessage = {
  tenantId: string;
  conversationId: string;
  type: "text" | "image" | "video" | "template";
  text?: string;
  mediaUrl?: string;
  templateName?: string;
  templateParams?: Record<string, string>;
};

export type ProductSummary = {
  id: string;
  name: string;
  priceBRL: number;
  variants: Array<{
    sku: string;
    color?: string;
    size?: string;
    stock: number;
  }>;
  mainPhoto?: string;
  styles: string[];
  occasions: string[];
  // Medidas reais por tamanho (ADR-006): { "M": { bust, waist, hips, length } } em cm
  measurements?: Record<string, { bust?: number; waist?: number; hips?: number; length?: number }>;
};

export type ShippingQuote = {
  carrier: string;
  service: string;
  priceBRL: number;
  deliveryDays: number;
};

export type ContactProfileUpdate = Partial<{
  name: string;
  height: number;
  bust: number;
  waist: number;
  hips: number;
  usualSize: string;
  styles: string[];
  occasions: string[];
  avoid: string[];
  favoriteColors: string[];
  preferredChannel: "whatsapp" | "instagram";
  preferredShipping: "fast" | "cheap";
}>;

export type Money = {
  amount: number;
  currency: "BRL";
};
