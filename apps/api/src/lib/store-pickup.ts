// Retirada na loja (ADR-034): resolve o link do Google Maps que a IA envia junto
// com o endereço. Usa o link explícito da loja (pin exato) quando houver; senão
// gera um link de busca a partir do texto do endereço. Pura (testável).

type Policies = Record<string, unknown> | null | undefined;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Link efetivo do Google Maps da loja (explícito > gerado do endereço > null). */
export function storeMapsUrl(policies: Policies): string | null {
  const explicit = str(policies?.["storeMapsUrl"]);
  if (explicit) return explicit;
  const address = str(policies?.["storeAddress"]);
  if (address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return null;
}

/** Devolve as políticas com `storeMapsUrl` resolvido (p/ a IA enxergar). */
export function enrichPoliciesWithMaps(policies: Policies): Record<string, unknown> {
  const base = (policies as Record<string, unknown>) ?? {};
  const url = storeMapsUrl(policies);
  return url ? { ...base, storeMapsUrl: url } : base;
}
