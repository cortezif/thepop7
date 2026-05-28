import { useEffect, useState } from "react";
import { Package, Truck, Sparkles, Plus, Download } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { api, downloadOrdersCsv, type Order } from "../lib/api";
import { cn, formatBRL } from "../lib/utils";

const STATUS_LABEL: Record<string, string> = {
  created: "Criado", paid: "Pago", picking: "Separação", shipped: "Postado",
  in_transit: "Em trânsito", out_for_delivery: "Saiu p/ entrega",
  delivered: "Entregue", finalized: "Finalizado", canceled: "Cancelado",
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

export function Pedidos() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [liaMsg, setLiaMsg] = useState<Record<string, string>>({});

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
    <div className="mx-auto max-w-6xl p-10">
      <div className="flex items-start justify-between">
        <PageHeader eyebrow="PEDIDOS · LIA" title="Ciclo do pedido e pós-venda" />
        <div className="flex items-center gap-2">
          {orders.length > 0 && (
            <button
              onClick={() => downloadOrdersCsv().catch((e) => setError(String(e)))}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              <Download size={15} /> Exportar CSV
            </button>
          )}
          <button
            onClick={createSample}
            disabled={busy === "sample"}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Plus size={15} /> {busy === "sample" ? "Criando…" : "Pedido de exemplo"}
          </button>
        </div>
      </div>
      {error && <p className="mt-4 text-sm text-primary">Erro: {error}</p>}

      {orders.length === 0 ? (
        <p className="mt-8 rounded-lg border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
          Nenhum pedido ainda. Clique em <b>Pedido de exemplo</b> para gerar um e exercitar o ciclo:
          ver pedido → simular entrega → disparar a Lia.
        </p>
      ) : (
        <div className="mt-8 space-y-4">
          {orders.map((o) => {
            const delivered = ["delivered", "finalized"].includes(o.status);
            return (
              <div key={o.id} className="rounded-lg border border-border bg-background p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package size={16} className="text-primary" />
                    <span className="font-medium">{o.contactName}</span>
                    <span className="text-xs text-muted-foreground">#{o.id.slice(-6)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {o.pendingApproval && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                        Aguardando aprovação
                      </span>
                    )}
                    <span className="rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider">
                      {STATUS_LABEL[o.status] ?? o.status}
                    </span>
                  </div>
                </div>

                <div className="mt-2 text-sm text-muted-foreground">
                  {o.items.map((i) => `${i.quantity}x ${i.name} (${i.variantSku})`).join(", ")}
                  <span className="ml-2 font-semibold text-foreground">{formatBRL(o.totalBRL)}</span>
                </div>

                {o.pendingApproval && (
                  <div className="mt-3 flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <span className="text-xs text-amber-700">
                      Pedido acima do limite de auto-aprovação — revise e libere o pagamento.
                    </span>
                    <button
                      onClick={() => approve(o.id)}
                      disabled={busy === `approve:${o.id}`}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {busy === `approve:${o.id}` ? "Aprovando…" : "Aprovar e gerar PIX"}
                    </button>
                  </div>
                )}

                {/* Timeline */}
                {o.timeline.length > 0 && (
                  <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {o.timeline.map((e, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <span className={cn("h-1.5 w-1.5 rounded-full", e.type.startsWith("postsale") ? "bg-primary" : "bg-muted-foreground/50")} />
                        <span className={cn(e.type.startsWith("postsale") ? "text-primary font-medium" : "text-muted-foreground")}>
                          {EVENT_LABEL[e.type] ?? e.type}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}

                {/* Ações */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {!delivered && (
                    <button
                      onClick={() => simulate(o.id)}
                      disabled={busy === o.id || o.status === "canceled"}
                      className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
                    >
                      <Truck size={14} /> {busy === o.id ? "Simulando…" : "Simular entrega"}
                    </button>
                  )}
                  {delivered && STAGES.map((s) => (
                    <button
                      key={s}
                      onClick={() => trigger(o.id, s)}
                      disabled={busy === `${o.id}:${s}`}
                      className="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      <Sparkles size={13} /> {busy === `${o.id}:${s}` ? "…" : `Lia ${s.toUpperCase()}`}
                    </button>
                  ))}
                </div>

                {liaMsg[o.id] && (
                  <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <Sparkles size={12} /> Lia
                    </p>
                    {liaMsg[o.id]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
