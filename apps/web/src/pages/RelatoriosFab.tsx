import { useEffect, useState } from "react";
import { TrendingUp, Factory, Boxes } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Page, Card, CardHeader, Badge, Skeleton } from "../components/ui";
import { api, type ManufacturingReport } from "../lib/api";
import { formatBRL } from "../lib/utils";

export function RelatoriosFab() {
  const [rep, setRep] = useState<ManufacturingReport | null>(null);
  useEffect(() => { api.manufacturingReport().then(setRep).catch(() => {}); }, []);

  if (!rep) return <Page><Skeleton className="h-96 w-full" /></Page>;

  const marginTone = (pct: number) => (pct < 20 ? "danger" : pct < 40 ? "warning" : "success");

  return (
    <Page>
      <PageHeader
        eyebrow="FABRICAÇÃO"
        title="Relatórios de fabricação"
        subtitle="Margem dos produtos com ficha técnica, produção realizada e consumo de insumos."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Lotes produzidos" value={String(rep.production.batches)} />
        <Stat label="Unidades produzidas" value={String(rep.production.units)} />
        <Stat label="Custo total de produção" value={formatBRL(rep.production.totalCostBRL)} />
      </div>

      {/* Margem por produto */}
      <Card className="mb-6">
        <CardHeader icon={TrendingUp} title="Margem por produto fabricado" subtitle="Preço de venda × custo da ficha técnica (custo unitário)." />
        {rep.margins.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nenhum produto com ficha técnica vinculada ainda.</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Produto</th>
                <th className="py-2 pr-3 text-right font-medium">Preço</th>
                <th className="py-2 pr-3 text-right font-medium">Custo</th>
                <th className="py-2 pr-3 text-right font-medium">Margem</th>
                <th className="py-2 text-right font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {rep.margins.map((m, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-foreground">{m.productName}</td>
                  <td className="py-2.5 pr-3 text-right">{formatBRL(m.priceBRL)}</td>
                  <td className="py-2.5 pr-3 text-right text-muted-foreground">{formatBRL(m.unitCost)}</td>
                  <td className="py-2.5 pr-3 text-right">{formatBRL(m.marginBRL)}</td>
                  <td className="py-2.5 text-right"><Badge tone={marginTone(m.marginPct)}>{m.marginPct}%</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Produção por produto */}
        <Card>
          <CardHeader icon={Factory} title="Produção por produto" subtitle="Total fabricado e custo, por receita." />
          {rep.production.byProduct.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nenhum lote registrado ainda.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {rep.production.byProduct.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{p.name}</span>
                  <span className="text-muted-foreground">{p.units} un · {formatBRL(p.costBRL)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Consumo de insumos */}
        <Card>
          <CardHeader icon={Boxes} title="Consumo de insumos" subtitle="Total consumido na produção (por custo)." />
          {rep.insumoConsumption.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nenhum consumo registrado ainda.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {rep.insumoConsumption.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{c.name}</span>
                  <span className="text-muted-foreground">{c.quantity} {c.baseUnit} · {formatBRL(c.costBRL)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="text-center">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 font-serif text-2xl font-semibold">{value}</p>
    </Card>
  );
}
