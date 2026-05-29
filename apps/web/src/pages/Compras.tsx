import { useEffect, useState } from "react";
import { AlertTriangle, Trophy, Truck, Sparkles, Barcode, Check, X } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { api, type ReorderSuggestion, type PurchaseRequest, type Supplier, type ReceivingItem, type ReceiveResult } from "../lib/api";
import { cn, formatBRL } from "../lib/utils";

export function Compras() {
  const [reorder, setReorder] = useState<ReorderSuggestion[]>([]);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [closeMsg, setCloseMsg] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<string | null>(null);

  async function suggestClose(requestId: string) {
    setBusy(requestId);
    try {
      const r = await api.purchaseCloseMessage(requestId);
      setCloseMsg((m) => ({ ...m, [requestId]: r.ok ? (r.message ?? "") : `(${r.error})` }));
    } catch (e) {
      setCloseMsg((m) => ({ ...m, [requestId]: `Erro: ${String(e)}` }));
    } finally {
      setBusy(null);
    }
  }

  function load() {
    Promise.all([api.reorder(), api.purchaseRequests(), api.suppliers()])
      .then(([r, p, s]) => { setReorder(r); setRequests(p); setSuppliers(s); })
      .catch((e) => setError(String(e)));
  }
  useEffect(load, []);

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
                {req.quotes.some((q) => q.selected) && (
                  <div className="mt-3">
                    <button
                      onClick={() => suggestClose(req.id)}
                      disabled={busy === req.id}
                      title="Bia sugere a mensagem de fechamento ao fornecedor recomendado"
                      className="flex items-center gap-1 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
                    >
                      <Sparkles size={12} /> {busy === req.id ? "Bia pensando…" : "Sugerir fechamento (Bia)"}
                    </button>
                    {closeMsg[req.id] && (
                      <div className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                        {closeMsg[req.id]}
                      </div>
                    )}
                  </div>
                )}
                {req.status !== "received" && (
                  <button
                    onClick={() => setReceiving(receiving === req.id ? null : req.id)}
                    className="mt-3 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    <Barcode size={13} /> Receber mercadoria
                  </button>
                )}
                {receiving === req.id && <ReceivingPanel requestId={req.id} onDone={() => { setReceiving(null); load(); }} />}
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

/** Conferência de recebimento da compra: bipa o que chegou e registra purchase_in. */
function ReceivingPanel({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const [items, setItems] = useState<ReceivingItem[]>([]);
  const [scanned, setScanned] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ReceiveResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getReceiving(requestId).then((l) => setItems(l.items)).catch((e) => setErr(String(e)));
  }, [requestId]);

  function addScan() {
    const c = input.trim();
    if (!c) return;
    setScanned((s) => [...s, c]); setInput(""); setResult(null);
  }

  async function confirmar() {
    setErr(null);
    try {
      const r = await api.receivePurchase(requestId, scanned);
      setResult(r);
      if (r.complete) setTimeout(onDone, 1200);
    } catch (e: any) { setErr(String(e?.message ?? e)); }
  }

  const scanCount = scanned.reduce<Record<string, number>>((m, c) => { m[c] = (m[c] ?? 0) + 1; return m; }, {});

  return (
    <div className="mt-3 rounded-md border border-border bg-muted/30 p-4">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Barcode size={13} /> Conferência de recebimento
      </p>
      <div className="flex gap-2">
        <input
          autoFocus value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addScan()}
          placeholder="Bipe o código do item que chegou…"
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
        <button onClick={confirmar} disabled={scanned.length === 0}
          className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:opacity-50">
          Conferir ({scanned.length})
        </button>
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {items.map((it) => {
          const got = scanCount[it.barcode ?? ""] ?? 0;
          const line = result?.items.find((r) => r.barcode === it.barcode);
          const conferred = line ? line.conferred : Math.min(got, it.quantity);
          const ok = !!it.barcode && conferred >= it.quantity;
          return (
            <li key={it.sku ?? it.description} className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                {ok ? <Check size={14} className="text-emerald-600" /> : <X size={14} className="text-muted-foreground" />}
                <span>{it.description}</span>
                <span className="text-xs text-muted-foreground">{it.barcode ?? "sem código"}</span>
              </span>
              <span className={cn("text-xs", ok ? "text-emerald-600" : "text-muted-foreground")}>{conferred}/{it.quantity}</span>
            </li>
          );
        })}
      </ul>
      {result && (
        <p className={cn("mt-2 flex items-center gap-1.5 text-sm font-medium", result.complete ? "text-emerald-700" : "text-amber-600")}>
          {result.complete ? <><Check size={14} /> Recebimento conferido — compra marcada como recebida.</> : <>Parcial — {result.recorded} código(s) lançado(s) no estoque.</>}
        </p>
      )}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  );
}
