import { getPrisma, withTenant } from "@hubadvisor/db";

// Entrega própria (ADR-030 — Fase 3). Modal (moto vs carro) escolhido pelo volume
// do pedido; preço pela faixa de distância do modal. Substitui a cotação de
// transportadora para lojas com motoboy/carro próprio.

export type Modal = "moto" | "carro";
export type Band = { modal: Modal; maxKm: number; priceBRL: number };
export type Tariff = { motoVolumeLimit: number; bands: Band[] };

export type DeliveryQuote = {
  modal: Modal;
  priceBRL: number;
  distanceKm: number;
  volume: number;
  maxKm: number | null;     // teto da faixa aplicada
  outOfRange: boolean;      // distância além da maior faixa do modal
  noTariff: boolean;        // sem faixa configurada para o modal
};

/** Tarifa-padrão sugerida quando a loja ainda não configurou (editável no painel). */
export const DEFAULT_TARIFF: Tariff = {
  motoVolumeLimit: 6,
  bands: [
    { modal: "moto", maxKm: 3, priceBRL: 8 },
    { modal: "moto", maxKm: 7, priceBRL: 14 },
    { modal: "moto", maxKm: 12, priceBRL: 20 },
    { modal: "carro", maxKm: 5, priceBRL: 25 },
    { modal: "carro", maxKm: 12, priceBRL: 40 },
    { modal: "carro", maxKm: 25, priceBRL: 70 },
  ],
};

/**
 * Cotação de entrega (função pura). Decide o modal pelo volume e busca a menor
 * faixa de distância do modal que cobre `distanceKm`. Se a distância passar da
 * maior faixa, usa o preço dela e marca `outOfRange`.
 */
export function quoteDelivery(input: { distanceKm: number; volume: number; tariff: Tariff }): DeliveryQuote {
  const { distanceKm, volume, tariff } = input;
  const modal: Modal = volume <= tariff.motoVolumeLimit ? "moto" : "carro";
  const candidates = (tariff.bands ?? [])
    .filter((b) => b.modal === modal && b.maxKm > 0)
    .sort((a, b) => a.maxKm - b.maxKm);

  if (candidates.length === 0) {
    return { modal, priceBRL: 0, distanceKm, volume, maxKm: null, outOfRange: false, noTariff: true };
  }
  const covering = candidates.find((b) => distanceKm <= b.maxKm);
  const band = covering ?? candidates[candidates.length - 1]!;
  return {
    modal,
    priceBRL: band.priceBRL,
    distanceKm,
    volume,
    maxKm: band.maxKm,
    outOfRange: !covering,
    noTariff: false,
  };
}

// ── Persistência (1 por tenant) ─────────────────────────────────────────────
function normalizeBands(bands: unknown): Band[] {
  if (!Array.isArray(bands)) return [];
  return bands
    .map((b: any): Band => ({
      modal: b?.modal === "carro" ? "carro" : "moto",
      maxKm: Number(b?.maxKm) || 0,
      priceBRL: Number(b?.priceBRL) || 0,
    }))
    .filter((b) => b.maxKm > 0);
}

export async function getTariff(tenantId: string): Promise<Tariff & { configured: boolean }> {
  const row = await getPrisma().deliveryTariff.findUnique({ where: { tenantId } });
  if (!row) return { ...DEFAULT_TARIFF, configured: false };
  return { motoVolumeLimit: row.motoVolumeLimit, bands: normalizeBands(row.bands), configured: true };
}

export async function saveTariff(tenantId: string, input: { motoVolumeLimit: number; bands: Band[] }) {
  const bands = normalizeBands(input.bands);
  const motoVolumeLimit = Number(input.motoVolumeLimit) || 0;
  await withTenant(tenantId, (tx) =>
    tx.deliveryTariff.upsert({
      where: { tenantId },
      create: { tenantId, motoVolumeLimit, bands: bands as any },
      update: { motoVolumeLimit, bands: bands as any },
    }),
  );
  return { ok: true as const, motoVolumeLimit, bands };
}

/** Cotação a partir da tarifa salva (ou padrão). */
export async function quoteForTenant(tenantId: string, distanceKm: number, volume: number): Promise<DeliveryQuote> {
  const tariff = await getTariff(tenantId);
  return quoteDelivery({ distanceKm, volume, tariff });
}

/**
 * Volume de um pedido = Σ (quantidade × Product.deliveryVolume). Usado pelo
 * cálculo automático de modal (Fase 4 liga isto ao fechamento da Maya).
 */
export async function orderVolume(tenantId: string, items: Array<{ productId: string; quantity: number }>): Promise<number> {
  if (items.length === 0) return 0;
  const ids = [...new Set(items.map((i) => i.productId))];
  const products = await getPrisma().product.findMany({ where: { id: { in: ids }, tenantId }, select: { id: true, deliveryVolume: true } });
  const volById = new Map(products.map((p) => [p.id, p.deliveryVolume ?? 1]));
  return items.reduce((acc, i) => acc + i.quantity * (volById.get(i.productId) ?? 1), 0);
}
