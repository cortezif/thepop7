import { useEffect, useState } from "react";
import { AlertTriangle, Trophy, Truck, Sparkles, Barcode, Check, X, Phone, Clock, Gauge } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Page, Card, CardHeader, Button, Badge, EmptyState, Skeleton, inputClass } from "../components/ui";
import { api, type ReorderSuggestion, type PurchaseRequest, type Supplier, type ReceivingItem, type ReceiveResult } from "../lib/api";
import { cn, formatBRL } from "../lib/utils";

export function Compras() {
  const [reorder, setReorder] = useState<ReorderSuggestion[]>([]);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
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
    setLoading(true);
    Promise.all([api.reorder(), api.purchaseRequests(), api.suppliers()])
      .then(([r, p, s]) => { setReorder(r); setRequests(p); setSuppliers(s); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const statusTone = (status: string) =>
    status === "received" ? "success" : status === "open" ? "info" : "neutral";

  return (
    <Page>
      <PageHeader
        eyebrow="COMPRAS · BIA"
        title="Reposição e fornecedores"
        subtitle="A central de abastecimento da boutique — reposição preditiva, cotações comparáveis e a rede de fornecedores que sustenta cada vitrine."
      />
      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Erro: {error}
        </div>
      )}

      <div className="space-y-8">
        {/* Reposição preditiva */}
        <Card padded={false}>
          <div className="p-6 pb-4">
            <CardHeader
              icon={AlertTriangle}
              title="Reposição preditiva"
              subtitle="Produtos no ou abaixo do ponto de pedido — velocidade de venda × lead time + estoque de segurança."
            />
          </div>
          {loading ? (
            <div className="space-y-2 px-6 pb-6">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-11 w-full" />)}
            </div>
          ) : reorder.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState
                icon={Check}
                title="Estoque em equilíbrio"
                description="Nenhum produto precisa de reposição no momento. A vitrine está bem servida."
              />
            </div>
          ) : (
            <div className="overflow-hidden border-t border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-[11px] uppercase tracking-luxe text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold">Produto</th>
                    <th className="px-6 py-3 text-right font-semibold">Estoque</th>
                    <th className="px-6 py-3 text-right font-semibold">Vendas 30d</th>
                    <th className="px-6 py-3 text-right font-semibold">Ponto pedido</th>
                    <th className="px-6 py-3 text-right font-semibold">Sugerido</th>
                  </tr>
                </thead>
                <tbody>
                  {reorder.map((r) => (
                    <tr key={r.productId} className="border-t border-border transition-colors hover:bg-muted/30">
                      <td className="px-6 py-3 font-serif font-medium text-foreground">{r.name}</td>
                      <td className="px-6 py-3 text-right font-semibold text-primary">{r.stock}</td>
                      <td className="px-6 py-3 text-right text-muted-foreground">{r.soldLast30}</td>
                      <td className="px-6 py-3 text-right text-muted-foreground">{r.reorderPoint}</td>
                      <td className="px-6 py-3 text-right">
                        <Badge tone="accent">{r.suggestedQty}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Cotações */}
        <Card>
          <CardHeader
            icon={Trophy}
            title="Cotações"
            subtitle="A Bia lê respostas de fornecedores em texto solto e ranqueia por preço × prazo × relacionamento."
          />
          <div className="mt-5">
            {loading ? (
              <div className="space-y-3">
                {[0, 1].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
              </div>
            ) : requests.length === 0 ? (
              <EmptyState
                icon={Trophy}
                title="Nenhuma cotação em aberto"
                description="Quando você abrir uma requisição, as propostas dos fornecedores aparecerão aqui, lado a lado."
              />
            ) : (
              <div className="space-y-4">
                {requests.map((req) => (
                  <div key={req.id} className="rounded-xl border border-border bg-background p-5">
                    <div className="flex items-start justify-between gap-4">
                      <span className="font-serif text-base font-medium text-foreground">
                        {req.items.map((i) => `${i.quantity}× ${i.description}`).join(", ")}
                      </span>
                      <Badge tone={statusTone(req.status)} className="uppercase tracking-wide">{req.status}</Badge>
                    </div>

                    {req.quotes.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {req.quotes.map((q, i) => (
                          <div
                            key={i}
                            className={cn(
                              "flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm transition-colors",
                              q.selected
                                ? "border border-primary/30 bg-accent-soft"
                                : "border border-transparent bg-muted/40",
                            )}
                          >
                            <span className="flex items-center gap-2 font-medium text-foreground">
                              {q.selected && <Trophy size={14} className="text-primary" />}
                              {q.supplier}
                              {q.selected && <Badge tone="accent">Selecionada</Badge>}
                            </span>
                            <span className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span className="font-serif text-sm font-semibold text-foreground">{formatBRL(q.totalBRL)}</span>
                              <span className="flex items-center gap-1"><Clock size={12} />{q.leadTimeDays}d</span>
                              <span>{q.paymentTerms}</span>
                              {q.score != null && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 font-mono text-[11px] text-foreground">
                                  <Gauge size={11} /> {q.score}
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {req.quotes.some((q) => q.selected) && (
                      <div className="mt-4">
                        <Button
                          variant="soft"
                          size="sm"
                          Icon={Sparkles}
                          onClick={() => suggestClose(req.id)}
                          disabled={busy === req.id}
                          title="Bia sugere a mensagem de fechamento ao fornecedor recomendado"
                        >
                          {busy === req.id ? "Bia pensando…" : "Sugerir fechamento (Bia)"}
                        </Button>
                        {closeMsg[req.id] && (
                          <div className="mt-3 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
                            {closeMsg[req.id]}
                          </div>
                        )}
                      </div>
                    )}

                    {req.status !== "received" && (
                      <div className="mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          Icon={Barcode}
                          onClick={() => setReceiving(receiving === req.id ? null : req.id)}
                        >
                          Receber mercadoria
                        </Button>
                      </div>
                    )}
                    {receiving === req.id && <ReceivingPanel requestId={req.id} onDone={() => { setReceiving(null); load(); }} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Fornecedores */}
        <Card>
          <CardHeader
            icon={Truck}
            title="Fornecedores"
            subtitle="A rede de parceiros que abastece a boutique, ordenada por relacionamento e agilidade."
          />
          <div className="mt-5">
            {loading ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
              </div>
            ) : suppliers.length === 0 ? (
              <EmptyState
                icon={Truck}
                title="Nenhum fornecedor cadastrado"
                description="Os fornecedores com quem você negocia aparecerão aqui em cards elegantes."
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {suppliers.map((s) => (
                  <div key={s.id} className="rounded-xl border border-border bg-background p-5 transition-shadow hover:shadow-soft">
                    <p className="font-serif text-base font-semibold text-foreground">{s.name}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Phone size={12} /> {s.contactPhone}
                    </p>
                    <div className="mt-4 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Gauge size={13} className="text-primary" />
                        relação
                        <span className="font-serif font-semibold text-foreground">{(s.relationshipScore * 100).toFixed(0)}%</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock size={13} className="text-primary" />
                        lead
                        <span className="font-serif font-semibold text-foreground">{s.avgLeadTimeDays}d</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </Page>
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
    <div className="mt-4 rounded-xl border border-border bg-accent-soft/40 p-5">
      <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-luxe text-primary">
        <Barcode size={14} /> Conferência de recebimento
      </p>
      <div className="flex gap-2">
        <input
          autoFocus value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addScan()}
          placeholder="Bipe o código do item que chegou…"
          className={cn(inputClass, "flex-1")}
        />
        <Button variant="primary" onClick={confirmar} disabled={scanned.length === 0}>
          Conferir ({scanned.length})
        </Button>
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {items.map((it) => {
          const got = scanCount[it.barcode ?? ""] ?? 0;
          const line = result?.items.find((r) => r.barcode === it.barcode);
          const conferred = line ? line.conferred : Math.min(got, it.quantity);
          const ok = !!it.barcode && conferred >= it.quantity;
          return (
            <li key={it.sku ?? it.description} className="flex items-center justify-between rounded-lg bg-card/60 px-3 py-2">
              <span className="flex items-center gap-2">
                {ok ? <Check size={15} className="text-emerald-600" /> : <X size={15} className="text-muted-foreground" />}
                <span className="font-medium text-foreground">{it.description}</span>
                <span className="text-xs text-muted-foreground">{it.barcode ?? "sem código"}</span>
              </span>
              <span className={cn("font-serif text-xs font-semibold", ok ? "text-emerald-600" : "text-muted-foreground")}>{conferred}/{it.quantity}</span>
            </li>
          );
        })}
      </ul>
      {result && (
        <p className={cn("mt-3 flex items-center gap-1.5 text-sm font-medium", result.complete ? "text-emerald-700" : "text-amber-600")}>
          {result.complete ? <><Check size={15} /> Recebimento conferido — compra marcada como recebida.</> : <>Parcial — {result.recorded} código(s) lançado(s) no estoque.</>}
        </p>
      )}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  );
}
