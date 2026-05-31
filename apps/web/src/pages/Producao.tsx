import { useEffect, useState } from "react";
import { Factory, Play, AlertTriangle, CheckCircle2, History, PackageCheck, CalendarClock } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Page, Card, CardHeader, Button, Badge, EmptyState, Skeleton, inputClass } from "../components/ui";
import { api, type Bom, type ProductionPlan, type ProductionBatch, type AgendaItem } from "../lib/api";
import { formatBRL } from "../lib/utils";

export function Producao() {
  const [boms, setBoms] = useState<Bom[] | null>(null);
  const [batches, setBatches] = useState<ProductionBatch[] | null>(null);
  const [agenda, setAgenda] = useState<AgendaItem[] | null>(null);

  async function loadBatches() { setBatches(await api.listBatches().catch(() => [])); }
  async function loadAgenda() { setAgenda(await api.productionAgenda().catch(() => [])); }
  useEffect(() => {
    api.listBoms().then(setBoms).catch(() => setBoms([]));
    loadAgenda();
    loadBatches();
  }, []);

  return (
    <Page>
      <PageHeader
        eyebrow="FABRICAÇÃO"
        title="Produção"
        subtitle="Encomendas a produzir + registro de lotes. Os insumos da ficha técnica são baixados do estoque; pronta-entrega soma o produto acabado à vitrine."
      />

      <div className="mb-6">
        <AgendaEncomendas agenda={agenda} onProduced={() => { loadAgenda(); loadBatches(); }} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <ProductionForm boms={boms} onDone={() => { loadBatches(); api.listBoms().then(setBoms).catch(() => {}); }} />
        <RecentBatches batches={batches} />
      </div>
    </Page>
  );
}

// ── Agenda de encomendas (produtos sob encomenda em pedidos abertos) ──────────
function AgendaEncomendas({ agenda, onProduced }: { agenda: AgendaItem[] | null; onProduced: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (agenda === null) return <Skeleton className="h-32 w-full" />;
  const today = new Date().toISOString().slice(0, 10);
  const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");

  async function produzir(orderId: string, variantSku: string) {
    const key = `${orderId}:${variantSku}`;
    setBusy(key); setErr(null);
    try {
      const r = await api.produceOrderItem(orderId, variantSku);
      if (!r.ok) setErr(r.error ?? "falha ao produzir");
      else onProduced();
    } catch (e: any) { setErr(e?.message ?? "erro"); } finally { setBusy(null); }
  }
  return (
    <Card>
      <CardHeader icon={CalendarClock} title="Encomendas a produzir" subtitle="Pedidos abertos com produtos sob encomenda, ordenados pela data-alvo." />
      {agenda.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nenhuma encomenda pendente.</p>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Produzir até</th>
              <th className="py-2 pr-3 font-medium">Produto</th>
              <th className="py-2 pr-3 text-center font-medium">Qtd</th>
              <th className="py-2 pr-3 font-medium">Cliente</th>
              <th className="py-2 pr-3 font-medium">Pedido</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {agenda.map((a, i) => {
              const overdue = a.dueDate < today;
              const isToday = a.dueDate === today;
              return (
                <tr key={`${a.orderId}-${a.variantSku}-${i}`} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5 pr-3">
                    <Badge tone={overdue ? "danger" : isToday ? "warning" : "neutral"}>
                      {fmtDate(a.dueDate)}{overdue ? " · atrasado" : isToday ? " · hoje" : ""}
                    </Badge>
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70" title={a.dateSource === "desejada" ? "data informada pela cliente" : "estimada por prazo de encomenda"}>
                      {a.dateSource === "desejada" ? "pedida" : "est."}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 font-medium text-foreground">{a.productName}</td>
                  <td className="py-2.5 pr-3 text-center">{a.quantity}</td>
                  <td className="py-2.5 pr-3 text-muted-foreground">{a.contactName}</td>
                  <td className="py-2.5 pr-3 text-xs text-muted-foreground">{new Date(a.orderDate).toLocaleDateString("pt-BR")} · {a.status}</td>
                  <td className="py-2.5 text-right">
                    <Button size="sm" variant="soft" Icon={Factory} onClick={() => produzir(a.orderId, a.variantSku)} disabled={busy === `${a.orderId}:${a.variantSku}`}>
                      {busy === `${a.orderId}:${a.variantSku}` ? "…" : "Produzir"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </Card>
  );
}

function ProductionForm({ boms, onDone }: { boms: Bom[] | null; onDone: () => void }) {
  const [bomId, setBomId] = useState("");
  const [qty, setQty] = useState("1");
  const [addToStock, setAddToStock] = useState(true);
  const [touchedStock, setTouchedStock] = useState(false);
  const [plan, setPlan] = useState<ProductionPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Plano de consumo ao vivo (servidor é a fonte de verdade do consumo/custo).
  useEffect(() => {
    const q = Number(qty);
    if (!bomId || !(q > 0)) { setPlan(null); return; }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.previewProduction(bomId, q)
        .then((p) => { if (!alive) return; setPlan(p); if (!touchedStock) setAddToStock(p.suggestedToStock); })
        .catch(() => { if (alive) setPlan(null); })
        .finally(() => { if (alive) setLoading(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [bomId, qty, touchedStock]);

  async function submit() {
    const q = Number(qty);
    if (!bomId || !(q > 0)) { setMsg({ kind: "err", text: "Escolha a receita e a quantidade." }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await api.createBatch({ bomId, quantity: q, addToStock: plan?.canAddToStock ? addToStock : false });
      setMsg({
        kind: "ok",
        text: `Lote registrado · custo ${formatBRL(r.totalCost)}` +
          (r.addedToStock ? " · estoque atualizado" : " · sob encomenda") +
          (r.hasShortfall ? " · ⚠ insumo ficou negativo" : ""),
      });
      onDone();
    } catch (e: any) { setMsg({ kind: "err", text: e?.message ?? "Erro ao registrar" }); }
    finally { setBusy(false); }
  }

  if (boms === null) return <Skeleton className="h-80 w-full" />;
  if (boms.length === 0) {
    return (
      <Card>
        <EmptyState icon={Factory} title="Nenhuma ficha técnica" description="Cadastre uma receita em Fichas técnicas para poder produzir." />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader icon={Factory} title="Novo lote" subtitle="Escolha a receita e quantas unidades vai produzir." />
      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Receita</span>
          <select className={inputClass} value={bomId} onChange={(e) => setBomId(e.target.value)}>
            <option value="">— selecione —</option>
            {boms.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Quantidade a produzir</span>
          <input className={inputClass} value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" />
        </label>

        {plan && (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Consumo de insumos</span>
              {loading && <span className="text-xs text-muted-foreground">atualizando…</span>}
            </div>
            <div className="space-y-1">
              {plan.lines.map((l) => (
                <div key={l.materialId} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{l.name}</span>
                  <span className={l.shortfall > 0 ? "text-amber-700" : "text-muted-foreground"}>
                    {l.needed} {l.baseUnit}
                    {l.shortfall > 0 && <span className="ml-1.5">⚠ falta {l.shortfall}</span>}
                    <span className="ml-2 text-xs text-muted-foreground/70">(tem {l.available})</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <span className="text-sm text-muted-foreground">Custo do lote</span>
              <span className="font-serif text-lg font-semibold">{formatBRL(plan.totalCost)} <span className="text-xs font-normal text-muted-foreground">({formatBRL(plan.unitCost)}/un)</span></span>
            </div>
          </div>
        )}

        {/* Modo: pronta-entrega vs sob encomenda */}
        <label className={`flex items-start gap-3 rounded-lg border p-3 ${plan?.canAddToStock ? "border-border cursor-pointer" : "border-dashed border-border opacity-60"}`}>
          <input
            type="checkbox"
            className="mt-0.5"
            checked={addToStock && !!plan?.canAddToStock}
            disabled={!plan?.canAddToStock}
            onChange={(e) => { setAddToStock(e.target.checked); setTouchedStock(true); }}
          />
          <span className="text-sm">
            <span className="font-medium text-foreground">Pronta-entrega — somar ao estoque de vitrine</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {plan?.canAddToStock
                ? "Desmarcado = produção sob encomenda (só consome insumos, não vira estoque)."
                : "Vincule a receita a um produto (e variante) para poder somar à vitrine."}
            </span>
          </span>
        </label>

        {msg && (
          <p className={`flex items-center gap-1.5 text-sm ${msg.kind === "ok" ? "text-emerald-700" : "text-red-600"}`}>
            {msg.kind === "ok" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{msg.text}
          </p>
        )}
        <Button Icon={Play} onClick={submit} disabled={busy || !plan}>{busy ? "Registrando…" : "Registrar produção"}</Button>
      </div>
    </Card>
  );
}

function RecentBatches({ batches }: { batches: ProductionBatch[] | null }) {
  if (batches === null) return <Skeleton className="h-80 w-full" />;
  return (
    <Card>
      <CardHeader icon={History} title="Lotes recentes" subtitle="Histórico de produção e consumo." />
      {batches.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">Nenhum lote produzido ainda.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {batches.map((b) => (
            <div key={b.id} className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">{b.bomName}</span>
                <Badge tone={b.addedToStock ? "success" : "neutral"}>
                  {b.addedToStock ? <><PackageCheck size={11} /> estoque +{b.quantity}</> : "sob encomenda"}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {b.quantity} un · {formatBRL(b.totalCost)} · {new Date(b.createdAt).toLocaleString("pt-BR")}
              </p>
              {b.consumed.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground/80">
                  Consumiu: {b.consumed.map((c) => `${c.name} ${c.quantity}${c.baseUnit}`).join(" · ")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
