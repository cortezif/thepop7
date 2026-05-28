import { useEffect, useState } from "react";
import { AlertTriangle, Trophy, Truck } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { api, type ReorderSuggestion, type PurchaseRequest, type Supplier } from "../lib/api";
import { cn, formatBRL } from "../lib/utils";

export function Compras() {
  const [reorder, setReorder] = useState<ReorderSuggestion[]>([]);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.reorder(), api.purchaseRequests(), api.suppliers()])
      .then(([r, p, s]) => { setReorder(r); setRequests(p); setSuppliers(s); })
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="mx-auto max-w-6xl p-10">
      <PageHeader eyebrow="COMPRAS · BIA" title="Reposição e fornecedores" />
      {error && <p className="mt-4 text-sm text-primary">Erro: {error}</p>}

      {/* Reposição preditiva */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-serif text-lg font-bold">
          <AlertTriangle size={18} className="text-primary" /> Reposição preditiva
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Produtos no ou abaixo do ponto de pedido (velocidade de venda × lead time + estoque de segurança).
        </p>
        {reorder.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            Nenhum produto precisa de reposição no momento.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Produto</th>
                  <th className="px-4 py-2 text-right">Estoque</th>
                  <th className="px-4 py-2 text-right">Vendas 30d</th>
                  <th className="px-4 py-2 text-right">Ponto pedido</th>
                  <th className="px-4 py-2 text-right">Sugerido</th>
                </tr>
              </thead>
              <tbody>
                {reorder.map((r) => (
                  <tr key={r.productId} className="border-t border-border">
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-4 py-2 text-right text-primary font-semibold">{r.stock}</td>
                    <td className="px-4 py-2 text-right">{r.soldLast30}</td>
                    <td className="px-4 py-2 text-right">{r.reorderPoint}</td>
                    <td className="px-4 py-2 text-right font-bold">{r.suggestedQty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cotações */}
      <section className="mt-10">
        <h2 className="flex items-center gap-2 font-serif text-lg font-bold">
          <Trophy size={18} className="text-primary" /> Cotações
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          A Bia lê respostas de fornecedores em texto solto e ranqueia por preço × prazo × relacionamento.
        </p>
        {requests.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            Nenhuma requisição de cotação ainda.
          </p>
        ) : (
          <div className="space-y-4">
            {requests.map((req) => (
              <div key={req.id} className="rounded-lg border border-border bg-background p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {req.items.map((i) => `${i.quantity}x ${i.description}`).join(", ")}
                  </span>
                  <span className="rounded bg-muted px-2 py-0.5 text-[10px] uppercase">{req.status}</span>
                </div>
                {req.quotes.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {req.quotes.map((q, i) => (
                      <div key={i} className={cn("flex items-center justify-between rounded px-3 py-1.5 text-sm", q.selected ? "bg-primary/10" : "bg-muted/40")}>
                        <span className="flex items-center gap-2">
                          {q.selected && <Trophy size={12} className="text-primary" />}
                          {q.supplier}
                        </span>
                        <span className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">{formatBRL(q.totalBRL)}</span>
                          <span>{q.leadTimeDays}d</span>
                          <span>{q.paymentTerms}</span>
                          {q.score != null && <span className="font-mono">score {q.score}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Fornecedores */}
      <section className="mt-10">
        <h2 className="flex items-center gap-2 font-serif text-lg font-bold">
          <Truck size={18} className="text-primary" /> Fornecedores
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          {suppliers.map((s) => (
            <div key={s.id} className="rounded-lg border border-border bg-background p-4">
              <p className="font-medium">{s.name}</p>
              <p className="text-xs text-muted-foreground">{s.contactPhone}</p>
              <div className="mt-2 flex justify-between text-xs">
                <span>relação <b>{(s.relationshipScore * 100).toFixed(0)}%</b></span>
                <span>lead <b>{s.avgLeadTimeDays}d</b></span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
