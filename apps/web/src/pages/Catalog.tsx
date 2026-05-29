import { useEffect, useState } from "react";
import { Store } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { formatBRL } from "../lib/utils";
import { api, type WholesaleProductRow } from "../lib/api";

type Product = {
  externalId: string;
  name: string;
  priceBRL: number;
  costBRL?: number;
  variants: Array<{ sku: string; color?: string; size?: string; stock: number }>;
  measurements?: Record<string, { bust?: number; waist?: number; hips?: number; length?: number }>;
};

function marginInfo(price: number, cost?: number) {
  if (cost == null) return null;
  const brl = price - cost;
  const pct = price > 0 ? (brl / price) * 100 : 0;
  // faixas: <40% baixa (âmbar), 40–60% ok, >60% alta (verde)
  const tone = pct >= 60 ? "bg-green-100 text-green-700" : pct >= 40 ? "bg-muted text-foreground" : "bg-amber-100 text-amber-700";
  return { brl, pct, tone };
}

export function Catalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/catalog/products")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: Product[]) => setProducts(data))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-6xl p-10">
      <PageHeader eyebrow="CATÁLOGO" title="Produtos sincronizados" />

      <WholesalePanel />

      {loading && <p className="mt-6 text-muted-foreground">Carregando…</p>}
      {error && <p className="mt-6 text-sm text-primary">Erro: {error}</p>}

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => {
          const totalStock = p.variants.reduce((s, v) => s + v.stock, 0);
          const m = marginInfo(p.priceBRL, p.costBRL);
          return (
            <div key={p.externalId} className="rounded-lg border border-border bg-background p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{p.externalId}</p>
              <h3 className="mt-1 font-serif text-lg font-bold">{p.name}</h3>
              <div className="mt-2 flex items-center gap-2">
                <p className="text-primary font-semibold">{formatBRL(p.priceBRL)}</p>
                {m ? (
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${m.tone}`} title={`Custo ${formatBRL(p.costBRL!)} · margem ${formatBRL(m.brl)}`}>
                    margem {m.pct.toFixed(0)}%
                  </span>
                ) : (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700" title="Cadastre o custo pra calcular a margem">
                    sem custo
                  </span>
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {p.variants.length} variantes · {totalStock} em estoque
              </p>
              {p.measurements && Object.keys(p.measurements).length > 0 && (
                <div className="mt-3 border-t border-border pt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Medidas por tamanho (cm)</p>
                  <table className="mt-1 w-full text-[11px]">
                    <thead className="text-muted-foreground">
                      <tr><th className="text-left font-normal">Tam</th><th className="text-right font-normal">Busto</th><th className="text-right font-normal">Cintura</th><th className="text-right font-normal">Quadril</th></tr>
                    </thead>
                    <tbody>
                      {Object.entries(p.measurements).map(([size, m]) => (
                        <tr key={size}>
                          <td className="font-medium">{size}</td>
                          <td className="text-right">{m.bust ?? "—"}</td>
                          <td className="text-right">{m.waist ?? "—"}</td>
                          <td className="text-right">{m.hips ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
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
    <section className="mt-6 rounded-lg border border-border bg-background">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 p-5 text-left">
        <Store size={18} className="text-muted-foreground" />
        <span className="font-serif text-lg font-bold">Rede de atacado (B2B)</span>
        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{exposed} exposto(s)</span>
        <span className="ml-auto text-sm text-muted-foreground">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-border p-5">
          <p className="mb-3 text-xs text-muted-foreground">
            Produtos marcados aqui ficam visíveis na rede de atacado (MCP) para outras lojas comprarem em grosso.
          </p>
          {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={r.wholesaleEnabled} disabled={busy === r.id}
                    onChange={(e) => save(r, { enabled: e.target.checked })} />
                  <span className="font-medium">{r.name}</span>
                </label>
                <span className="text-xs text-muted-foreground">varejo {formatBRL(r.priceBRL)} · estoque {r.stock}</span>
                <div className="ml-auto flex items-center gap-2 text-sm">
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    atacado R$
                    <input type="number" min={0} step="0.01" defaultValue={r.wholesalePriceBRL ?? ""}
                      onBlur={(e) => { const v = Number(e.target.value); if (e.target.value && v !== r.wholesalePriceBRL) save(r, { priceBRL: v }); }}
                      className="w-24 rounded border border-border bg-background px-2 py-1" />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    mín
                    <input type="number" min={1} defaultValue={r.wholesaleMinQty}
                      onBlur={(e) => { const v = Number(e.target.value); if (v && v !== r.wholesaleMinQty) save(r, { minQty: v }); }}
                      className="w-16 rounded border border-border bg-background px-2 py-1" />
                  </label>
                </div>
              </div>
            ))}
            {rows.length === 0 && <p className="py-3 text-sm text-muted-foreground">Nenhum produto interno encontrado.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
