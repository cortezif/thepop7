import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { formatBRL } from "../lib/utils";

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
