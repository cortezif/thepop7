import { useEffect, useState } from "react";
import { Package, Truck, Sparkles, Plus, Download, Barcode, Check, X, FileWarning, FileText, ShieldAlert } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Page, Card, CardHeader, Button, Badge, EmptyState, inputClass } from "../components/ui";
import { api, downloadOrdersCsv, type Order, type PickingItem, type PackResult } from "../lib/api";
import { cn, formatBRL } from "../lib/utils";

const STATUS_LABEL: Record<string, string> = {
  created: "Criado", paid: "Pago", picking: "Separação", shipped: "Postado",
  in_transit: "Em trânsito", out_for_delivery: "Saiu p/ entrega",
  delivered: "Entregue", finalized: "Finalizado", canceled: "Cancelado",
};

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  created: "neutral", paid: "info", picking: "warning", shipped: "info",
  in_transit: "info", out_for_delivery: "info",
  delivered: "success", finalized: "success", canceled: "danger",
};

const EVENT_LABEL: Record<string, string> = {
  "order.created": "Pedido criado", "order.paid": "Pagamento confirmado",
  "order.picking": "Separação", "order.shipped": "Postado",
  "order.in_transit": "Em trânsito", "order.delivered": "Entregue",
  "postsale.d1": "Lia · D+1 (chegou tudo certo?)",
  "postsale.d7": "Lia · D+7 (prazo de troca)",
  "postsale.d14": "Lia · D+14 (avaliação)",
  "postsale.d30": "Lia · D+30 (recompra)",
};

const STAGES = ["d1", "d7", "d14", "d30"] as const;
const NFE_PENDING_STATUSES = ["paid", "picking", "shipped", "in_transit", "out_for_delivery", "delivered", "finalized"];

export function Pedidos() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [liaMsg, setLiaMsg] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<string | null>(null);

  function load() {
    api.listOrders().then(setOrders).catch((e) => setError(String(e)));
  }
  useEffect(load, []);

  async function createSample() {
    setBusy("sample"); setError(null);
    try { await api.createSampleOrder(); load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  async function simulate(id: string) {
    setBusy(id); setError(null);
    try { await api.simulateDelivery(id); load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  async function emitNfe(id: string) {
    setBusy(`nfe:${id}`); setError(null);
    try {
      const r = await api.issueNfe(id);
      if (!r.ok && !r.skipped) setError(r.reason ?? "falha ao emitir NF-e");
      load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  async function approve(id: string) {
    setBusy(`approve:${id}`); setError(null);
    try {
      const r = await api.approveOrder(id);
      if (!r.ok) setError(r.reason ?? "falha ao aprovar");
      load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  async function trigger(id: string, stage: (typeof STAGES)[number]) {
    setBusy(`${id}:${stage}`); setError(null);
    try {
      const r = await api.triggerPostSale(id, stage);
      setLiaMsg((m) => ({ ...m, [id]: r.skipped ? `(pulado: ${r.reason})` : r.message ?? "" }));
      load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <div className="flex items-start justify-between gap-4">
        <PageHeader eyebrow="PEDIDOS · LIA" title="Ciclo do pedido e pós-venda" />
        <div className="flex shrink-0 items-center gap-2 pt-1">
          {orders.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              Icon={Download}
              onClick={() => downloadOrdersCsv().catch((e) => setError(String(e)))}
            >
              Exportar CSV
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            Icon={Plus}
            onClick={createSample}
            disabled={busy === "sample"}
          >
            {busy === "sample" ? "Criando…" : "Pedido de exemplo"}
          </Button>
        </div>
      </div>

      {error && (
        <p className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Erro: {error}
        </p>
      )}

      {orders.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Nenhum pedido ainda"
          description="Gere um pedido de exemplo para exercitar o ciclo completo: ver pedido → simular entrega → disparar a Lia."
          action={
            <Button variant="primary" size="md" Icon={Plus} onClick={createSample} disabled={busy === "sample"}>
              {busy === "sample" ? "Criando…" : "Pedido de exemplo"}
            </Button>
          }
        />
      ) : (
        <div className="space-y-5">
          {orders.map((o) => {
            const delivered = ["delivered", "finalized"].includes(o.status);
            return (
              <Card key={o.id} hover>
                <CardHeader
                  icon={Package}
                  title={o.contactName}
                  subtitle={`Pedido #${o.id.slice(-6)}`}
                  action={
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {o.pendingApproval && (
                        <Badge tone="warning">
                          <ShieldAlert size={12} /> Aguardando aprovação
                        </Badge>
                      )}
                      <Badge tone={STATUS_TONE[o.status] ?? "neutral"}>
                        {STATUS_LABEL[o.status] ?? o.status}
                      </Badge>
                    </div>
                  }
                />

                <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-border pt-4">
                  <p className="text-sm text-muted-foreground">
                    {o.items.map((i) => `${i.quantity}× ${i.name} (${i.variantSku})`).join(", ")}
                  </p>
                  <span className="font-serif text-xl font-semibold text-foreground">{formatBRL(o.totalBRL)}</span>
                </div>

                {o.nfeNumber ? (
                  <div className="mt-3 flex items-center gap-2 text-xs text-emerald-700">
                    <FileText size={13} /> NF-e {o.nfeNumber}
                    {o.nfePdfUrl && (
                      <a href={o.nfePdfUrl} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
                        DANFE (PDF)
                      </a>
                    )}
                  </div>
                ) : NFE_PENDING_STATUSES.includes(o.status) && (
                  <div className="mt-3 flex items-center gap-3 text-xs text-amber-700">
                    <span className="flex items-center gap-1.5">
                      <FileWarning size={13} /> NF-e pendente
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => emitNfe(o.id)}
                      disabled={busy === `nfe:${o.id}`}
                      className="border-amber-300 text-amber-800 hover:bg-amber-50"
                    >
                      {busy === `nfe:${o.id}` ? "Emitindo…" : "Emitir NF-e"}
                    </Button>
                  </div>
                )}

                {o.pendingApproval && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <span className="flex items-center gap-2 text-xs text-amber-800">
                      <ShieldAlert size={14} className="shrink-0" />
                      Pedido acima do limite de auto-aprovação — revise e libere o pagamento.
                    </span>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => approve(o.id)}
                      disabled={busy === `approve:${o.id}`}
                    >
                      {busy === `approve:${o.id}` ? "Aprovando…" : "Aprovar e gerar PIX"}
                    </Button>
                  </div>
                )}

                {/* Timeline */}
                {o.timeline.length > 0 && (
                  <ol className="mt-5 border-l border-border pl-5">
                    {o.timeline.map((e, i) => {
                      const isPost = e.type.startsWith("postsale");
                      return (
                        <li key={i} className="relative pb-3 last:pb-0">
                          <span
                            className={cn(
                              "absolute -left-[1.4rem] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-card",
                              isPost ? "bg-primary" : "bg-muted-foreground/40",
                            )}
                          />
                          <span className={cn("text-xs", isPost ? "font-medium text-primary" : "text-muted-foreground")}>
                            {EVENT_LABEL[e.type] ?? e.type}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}

                {/* Ações */}
                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                  {!delivered && (
                    <Button
                      variant="outline"
                      size="sm"
                      Icon={Truck}
                      onClick={() => simulate(o.id)}
                      disabled={busy === o.id || o.status === "canceled"}
                    >
                      {busy === o.id ? "Simulando…" : "Simular entrega"}
                    </Button>
                  )}
                  {delivered && STAGES.map((s) => (
                    <Button
                      key={s}
                      variant="soft"
                      size="sm"
                      Icon={Sparkles}
                      onClick={() => trigger(o.id, s)}
                      disabled={busy === `${o.id}:${s}`}
                    >
                      {busy === `${o.id}:${s}` ? "…" : `Lia ${s.toUpperCase()}`}
                    </Button>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    Icon={Barcode}
                    onClick={() => setPicking(picking === o.id ? null : o.id)}
                  >
                    Conferir envio
                  </Button>
                </div>

                {picking === o.id && <PickingPanel orderId={o.id} />}

                {liaMsg[o.id] && (
                  <div className="mt-4 rounded-lg border border-primary/30 bg-accent-soft/60 p-4 text-sm text-foreground">
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-luxe text-primary">
                      <Sparkles size={12} /> Lia
                    </p>
                    {liaMsg[o.id]}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}

/** Conferência de envio por scan: bipa os itens e reconcilia contra o pedido. */
function PickingPanel({ orderId }: { orderId: string }) {
  const [items, setItems] = useState<PickingItem[]>([]);
  const [scanned, setScanned] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<PackResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getPicking(orderId).then((l) => setItems(l.items)).catch((e) => setErr(String(e)));
  }, [orderId]);

  function addScan() {
    const code = input.trim();
    if (!code) return;
    setScanned((s) => [...s, code]);
    setInput("");
    setResult(null);
  }

  async function conferir() {
    setErr(null);
    try { setResult(await api.packOrder(orderId, scanned)); }
    catch (e: any) { setErr(String(e?.message ?? e)); }
  }

  // contagem bipada por código (pré-visualização antes de conferir)
  const scanCount = scanned.reduce<Record<string, number>>((m, c) => { m[c] = (m[c] ?? 0) + 1; return m; }, {});

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/40 p-5">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-luxe text-muted-foreground">
        <Barcode size={13} /> Conferência de envio
      </p>

      <div className="flex gap-2">
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addScan()}
          placeholder="Bipe o código de barras do item…"
          className={cn(inputClass, "flex-1")}
        />
        <Button variant="primary" size="md" onClick={conferir} disabled={scanned.length === 0}>
          Conferir ({scanned.length})
        </Button>
      </div>

      <ul className="mt-4 space-y-2 text-sm">
        {items.map((it) => {
          const got = scanCount[it.barcode ?? ""] ?? 0;
          const line = result?.items.find((r) => r.variantSku === it.variantSku);
          const conferred = line ? line.conferred : Math.min(got, it.quantity);
          const ok = conferred >= it.quantity;
          return (
            <li key={it.variantSku} className="flex items-center justify-between rounded-md bg-card px-3 py-2 shadow-soft">
              <span className="flex items-center gap-2.5">
                {ok
                  ? <Check size={15} className="shrink-0 text-emerald-600" />
                  : <X size={15} className="shrink-0 text-muted-foreground" />}
                <span className="text-foreground">{it.description}</span>
                <span className="text-xs text-muted-foreground">{it.barcode ?? "sem código"}</span>
              </span>
              <span className={cn("text-xs font-medium", ok ? "text-emerald-600" : "text-muted-foreground")}>
                {conferred}/{it.quantity}
              </span>
            </li>
          );
        })}
      </ul>

      {result && (
        <div className="mt-4 text-sm">
          {result.complete ? (
            <p className="flex items-center gap-1.5 font-medium text-emerald-700"><Check size={15} /> Envio conferido — tudo certo.</p>
          ) : (
            <p className="flex items-center gap-1.5 font-medium text-red-600"><X size={15} /> Divergência na conferência.</p>
          )}
          {result.extras.length > 0 && (
            <p className="mt-1.5 text-xs text-red-600">
              Códigos fora do pedido: {result.extras.map((e) => `${e.barcode} (${e.count})`).join(", ")}
            </p>
          )}
        </div>
      )}
      {err && <p className="mt-3 text-xs text-red-600">{err}</p>}
    </div>
  );
}
