import { useEffect, useState } from "react";
import { Store, Shirt, ChevronDown, ChevronUp, Boxes } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { formatBRL } from "../lib/utils";
import { api, type WholesaleProductRow } from "../lib/api";
import { Page, Card, Button, Badge, EmptyState, Skeleton, inputClass } from "../components/ui";

type Product = {
  externalId: string;
  name: string;
  priceBRL: number;
  costBRL?: number;
  variants: Array<{ sku: string; color?: string; size?: string; stock: number }>;
  measurements?: Record<string, { bust?: number; waist?: number; hips?: number; length?: number }>;
};

type MarginInfo = { brl: number; pct: number; tone: "success" | "neutral" | "warning" };

function marginInfo(price: number, cost?: number): MarginInfo | null {
  if (cost == null) return null;
  const brl = price - cost;
  const pct = price > 0 ? (brl / price) * 100 : 0;
  // faixas: <40% baixa (âmbar), 40–60% ok, >60% alta (verde)
  const tone: MarginInfo["tone"] = pct >= 60 ? "success" : pct >= 40 ? "neutral" : "warning";
  return { brl, pct, tone };
}

export function Catalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFashion, setIsFashion] = useState(true); // segmento do tenant (ADR-029)

  useEffect(() => {
    fetch("/api/catalog/products")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: Product[]) => setProducts(data))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    api.getConfig().then((c) => setIsFashion((c.segment ?? "moda").toLowerCase() === "moda")).catch(() => {});
  }, []);

  return (
    <Page>
      <PageHeader eyebrow="CATÁLOGO" title="A coleção" />

      <WholesalePanel />

      {error && (
        <p className="mt-6 text-sm text-red-600">Erro: {error}</p>
      )}

      {loading && (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} padded={false} className="overflow-hidden">
              <Skeleton className="aspect-[3/4] rounded-none" />
              <div className="space-y-3 p-5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-24" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {!loading && !error && products.length === 0 && (
        <div className="mt-8">
          <EmptyState
            icon={Shirt}
            title="Nenhuma peça no catálogo"
            description="Os produtos sincronizados do seu ERP aparecem aqui assim que a integração estiver ativa."
          />
        </div>
      )}

      {!loading && products.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => {
            const totalStock = p.variants.reduce((s, v) => s + v.stock, 0);
            const m = marginInfo(p.priceBRL, p.costBRL);
            const hasMeasurements = isFashion && p.measurements && Object.keys(p.measurements).length > 0;
            return (
              <Card key={p.externalId} hover padded={false} className="group flex flex-col overflow-hidden">
                {/* Foto — herói visual */}
                <div className="relative aspect-[3/4] overflow-hidden rounded-t-xl bg-gradient-to-br from-muted to-accent-soft">
                  <div className="flex h-full w-full items-center justify-center text-primary/30 transition-transform duration-500 group-hover:scale-105">
                    <Shirt size={56} strokeWidth={1} />
                  </div>
                  <div className="absolute left-3 top-3">
                    {m ? (
                      <Badge
                        tone={m.tone}
                        className="shadow-soft"
                        // título preservado: contexto de custo/margem
                      >
                        <span title={`Custo ${formatBRL(p.costBRL!)} · margem ${formatBRL(m.brl)}`}>
                          margem {m.pct.toFixed(0)}%
                        </span>
                      </Badge>
                    ) : (
                      <Badge tone="warning" className="shadow-soft">
                        <span title="Cadastre o custo pra calcular a margem">sem custo</span>
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Conteúdo */}
                <div className="flex flex-1 flex-col p-5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {p.externalId}
                  </p>
                  <h3 className="mt-1.5 font-serif text-lg font-semibold leading-snug text-foreground">
                    {p.name}
                  </h3>

                  <div className="mt-3 flex items-baseline gap-2">
                    <p className="font-serif text-xl font-semibold text-foreground">{formatBRL(p.priceBRL)}</p>
                  </div>

                  <p className="mt-3 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{p.variants.length}</span> variante(s)
                    <span className="mx-1.5 text-border">·</span>
                    <span className="font-medium text-foreground">{totalStock}</span> em estoque
                  </p>

                  {hasMeasurements && (
                    <div className="mt-4 border-t border-border pt-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Medidas por tamanho (cm)
                      </p>
                      <table className="mt-2 w-full text-[11px]">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="pb-1 text-left font-normal">Tam</th>
                            <th className="pb-1 text-right font-normal">Busto</th>
                            <th className="pb-1 text-right font-normal">Cintura</th>
                            <th className="pb-1 text-right font-normal">Quadril</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {Object.entries(p.measurements!).map(([size, mm]) => (
                            <tr key={size}>
                              <td className="py-1 font-medium text-foreground">{size}</td>
                              <td className="py-1 text-right text-muted-foreground">{mm.bust ?? "—"}</td>
                              <td className="py-1 text-right text-muted-foreground">{mm.waist ?? "—"}</td>
                              <td className="py-1 text-right text-muted-foreground">{mm.hips ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}

/** Opt-in de atacado B2B (ADR-024): expõe produtos na rede com preço/qtd mínima. */
function WholesalePanel() {
  const [rows, setRows] = useState<WholesaleProductRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() { api.listWholesale().then(setRows).catch((e) => setErr(String(e))); }
  useEffect(() => { if (open && rows.length === 0) load(); }, [open]);

  async function save(r: WholesaleProductRow, patch: { enabled?: boolean; priceBRL?: number | null; minQty?: number }) {
    setBusy(r.id); setErr(null);
    const enabled = patch.enabled ?? r.wholesaleEnabled;
    try {
      await api.setWholesale(r.id, {
        enabled,
        priceBRL: patch.priceBRL !== undefined ? patch.priceBRL : r.wholesalePriceBRL,
        minQty: patch.minQty !== undefined ? patch.minQty : r.wholesaleMinQty,
      });
      load();
    } catch (e: any) {
      setErr(/400/.test(String(e)) ? "Informe o preço de atacado para expor." : String(e?.message ?? e));
    } finally { setBusy(null); }
  }

  const exposed = rows.filter((r) => r.wholesaleEnabled).length;

  return (
    <Card padded={false} className="mt-6 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-6 py-5 text-left transition-colors hover:bg-muted/40"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-primary">
          <Store size={17} />
        </span>
        <span className="font-serif text-lg font-semibold text-foreground">Rede de atacado (B2B)</span>
        <Badge tone="accent">{exposed} exposto(s)</Badge>
        <span className="ml-auto text-muted-foreground">
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-6 py-5">
          <p className="mb-4 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Produtos marcados aqui ficam visíveis na rede de atacado (MCP) para outras lojas comprarem em grosso.
          </p>
          {err && <p className="mb-4 text-sm text-red-600">{err}</p>}
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-3.5">
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={r.wholesaleEnabled}
                    disabled={busy === r.id}
                    onChange={(e) => save(r, { enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-border text-primary accent-primary focus:ring-2 focus:ring-accent-soft"
                  />
                  <span className="font-medium text-foreground">{r.name}</span>
                </label>
                <span className="text-xs text-muted-foreground">
                  varejo <span className="font-medium text-foreground">{formatBRL(r.priceBRL)}</span>
                  <span className="mx-1.5 text-border">·</span>
                  estoque <span className="font-medium text-foreground">{r.stock}</span>
                </span>
                <div className="ml-auto flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    atacado R$
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      defaultValue={r.wholesalePriceBRL ?? ""}
                      onBlur={(e) => { const v = Number(e.target.value); if (e.target.value && v !== r.wholesalePriceBRL) save(r, { priceBRL: v }); }}
                      className={`${inputClass} w-28 px-2.5 py-1.5`}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    mín
                    <input
                      type="number"
                      min={1}
                      defaultValue={r.wholesaleMinQty}
                      onBlur={(e) => { const v = Number(e.target.value); if (v && v !== r.wholesaleMinQty) save(r, { minQty: v }); }}
                      className={`${inputClass} w-20 px-2.5 py-1.5`}
                    />
                  </label>
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="py-6">
                <EmptyState
                  icon={Boxes}
                  title="Nenhum produto interno encontrado"
                  description="Sincronize o catálogo do seu ERP para expor peças na rede de atacado."
                />
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
