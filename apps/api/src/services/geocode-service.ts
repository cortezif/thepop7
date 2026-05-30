// Geocoding (ADR-030 — entrega on-demand). Converte CEP/endereço em coordenadas
// (lat/lng), necessário para cotar entregador (o courier opera por coordenadas,
// não por CEP). Provider padrão: Nominatim/OpenStreetMap (gratuito, sem chave);
// se GEOCODING_API_KEY estiver setada, usa Google Geocoding. Cache em memória
// (CEP é estável) para respeitar o rate-limit do Nominatim (~1 req/s).

export type GeoCoords = { lat: number; lng: number; label?: string };

const cache = new Map<string, GeoCoords | null>();

/** Só dígitos do CEP (8). Pura. */
export function normalizeCep(cep: string): string {
  return String(cep ?? "").replace(/\D/g, "").slice(0, 8);
}

/**
 * Monta queries de endereço (da mais específica à mais grosseira) a partir do
 * ViaCEP (pura). Ex.: [rua+bairro+cidade+uf, bairro+cidade+uf, cidade+uf].
 * Permite fallback progressivo no geocoder quando o endereço exato não existe
 * no OSM — garante ao menos coordenada de nível cidade.
 */
export function buildAddressQueries(viacep: unknown): string[] {
  const v = viacep as any;
  if (!v || v.erro) return [];
  const s = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
  const log = s(v.logradouro), bai = s(v.bairro), cid = s(v.localidade), uf = s(v.uf);
  const out: string[] = [];
  const push = (...parts: (string | null)[]) => {
    const f = parts.filter(Boolean);
    if (f.length) out.push(`${f.join(", ")}, Brasil`);
  };
  if (log) push(log, bai, cid, uf);
  if (bai) push(bai, cid, uf);
  push(cid, uf);
  return [...new Set(out)];
}

/** @deprecated use buildAddressQueries (mantido p/ compat de teste). */
export function buildAddressQuery(viacep: unknown): string | null {
  return buildAddressQueries(viacep)[0] ?? null;
}

/** Parser puro da resposta do Nominatim (array). Devolve a 1ª coordenada válida. */
export function parseNominatim(raw: unknown): GeoCoords | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const r = raw[0] as any;
  const lat = Number(r?.lat);
  const lng = Number(r?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, label: typeof r?.display_name === "string" ? r.display_name : undefined };
}

/** Parser puro da resposta do Google Geocoding. */
export function parseGoogleGeocode(raw: unknown): GeoCoords | null {
  const results = (raw as any)?.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const loc = results[0]?.geometry?.location;
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, label: typeof results[0]?.formatted_address === "string" ? results[0].formatted_address : undefined };
}

const NOMINATIM_UA = "HubAdvisor/1.0 (geocoding for delivery quotes)";

async function nominatimSearch(params: Record<string, string>): Promise<GeoCoords | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  for (const [k, v] of Object.entries({ format: "json", limit: "1", ...params })) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { "User-Agent": NOMINATIM_UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return parseNominatim(await res.json());
}

/**
 * Geocoding free (BR): ViaCEP (CEP→endereço, confiável no Brasil) → Nominatim por
 * texto livre do endereço. Mais preciso que Nominatim por postalcode (cuja
 * cobertura de CEP no Brasil é fraca). Fallback: Nominatim por postalcode.
 */
async function geocodeNominatim(cep: string): Promise<GeoCoords | null> {
  try {
    const vc = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { headers: { Accept: "application/json" } });
    if (vc.ok) {
      const queries = buildAddressQueries(await vc.json());
      // Tenta da mais específica à mais grosseira (rua → bairro → cidade).
      for (const q of queries) {
        const hit = await nominatimSearch({ q });
        if (hit) return hit;
      }
    }
  } catch { /* cai pro fallback abaixo */ }
  // Fallback: postalcode direto (menos confiável no BR).
  return nominatimSearch({ postalcode: cep, country: "Brazil" });
}

async function geocodeGoogle(cep: string, key: string): Promise<GeoCoords | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("components", `postal_code:${cep}|country:BR`);
  url.searchParams.set("key", key);
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Google geocode ${res.status}`);
  return parseGoogleGeocode(await res.json());
}

/**
 * Geocodifica um CEP brasileiro → coordenadas. Cacheado em memória. Retorna null
 * se não encontrar (chamador decide o fallback). Nunca lança por rede: erro vira
 * null + log do chamador, para não derrubar a cotação.
 */
export async function geocodeCep(cep: string): Promise<GeoCoords | null> {
  const c = normalizeCep(cep);
  if (c.length !== 8) return null;
  if (cache.has(c)) return cache.get(c)!;
  try {
    const key = process.env.GEOCODING_API_KEY;
    const coords = key ? await geocodeGoogle(c, key) : await geocodeNominatim(c);
    cache.set(c, coords);
    return coords;
  } catch {
    return null; // não cacheia falha de rede (pode ser transitória)
  }
}
