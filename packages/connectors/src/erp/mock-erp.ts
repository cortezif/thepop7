import type { ErpConnector, ErpProduct, ErpOrderInput } from "../types.js";

const CATALOG: ErpProduct[] = [
  {
    externalId: "BL-001",
    name: "Vestido Floral Manga 3/4",
    description: "Vestido midi com estampa floral.",
    priceBRL: 289,
    costBRL: 102,
    variants: [
      { sku: "BL-001-P-AZUL", color: "Azul", size: "P", stock: 3 },
      { sku: "BL-001-M-AZUL", color: "Azul", size: "M", stock: 1 },
      { sku: "BL-001-G-AZUL", color: "Azul", size: "G", stock: 0 },
      { sku: "BL-001-M-ROSA", color: "Rosa", size: "M", stock: 2 },
    ],
    photos: [],
    measurements: {
      P: { bust: 86, waist: 68, hips: 92, length: 98 },
      M: { bust: 92, waist: 74, hips: 98, length: 100 },
      G: { bust: 98, waist: 80, hips: 104, length: 102 },
    },
  },
  {
    externalId: "BL-002",
    name: "Conjunto Alfaiataria Festa",
    description: "Conjunto de alfaiataria preto para eventos formais.",
    priceBRL: 459,
    costBRL: 92,
    variants: [
      { sku: "BL-002-M-PRETO", color: "Preto", size: "M", stock: 9 },
      { sku: "BL-002-G-PRETO", color: "Preto", size: "G", stock: 8 },
    ],
    photos: [],
    measurements: {
      M: { bust: 90, waist: 72, hips: 96, length: 110 },
      G: { bust: 96, waist: 78, hips: 102, length: 112 },
    },
  },
];

export class MockErp implements ErpConnector {
  async listProducts(): Promise<ErpProduct[]> {
    return CATALOG;
  }
  async getProduct(externalId: string): Promise<ErpProduct | null> {
    return CATALOG.find((p) => p.externalId === externalId) ?? null;
  }
  async getStock(sku: string): Promise<number> {
    for (const p of CATALOG) {
      const v = p.variants.find((v) => v.sku === sku);
      if (v) return v.stock;
    }
    return 0;
  }
  async createOrder(_order: ErpOrderInput): Promise<{ externalId: string }> {
    return { externalId: "mock-order-" + Date.now() };
  }
  async cancelOrder(_externalId: string, _reason: string): Promise<void> {
    return;
  }
}
