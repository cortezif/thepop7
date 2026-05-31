import { useEffect, useState } from "react";
import { Wallet, TrendingUp, TrendingDown, Plus, Trash2, ChevronLeft, ChevronRight, ShoppingBag, Download, AlertTriangle, CheckCircle2, CalendarClock } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { Page, Card, CardHeader, Button, Badge, EmptyState, Skeleton, inputClass } from "../components/ui";
import { api, downloadCashflowCsv, type Cashflow, type FinanceEntry, type OpenAccount } from "../lib/api";
import { formatBRL } from "../lib/utils";

const DESPESA_CATS = ["fornecedor", "salario", "aluguel", "marketing", "imposto", "frete", "outro"];
const RECEITA_CATS = ["servico", "outro"];

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y!, mo! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y!, mo! - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export function Financeiro() {
  const [month, setMonth] = useState(thisMonth());
  const [cf, setCf] = useState<Cashflow | null>(null);
  const [entries, setEntries] = useState<FinanceEntry[] | null>(null);
  const [open, setOpen] = useState<OpenAccount[] | null>(null);
  const [adding, setAdding] = useState(false);

  function load() {
    setCf(null); setEntries(null);
    api.cashflow(month).then(setCf).catch(() => setCf(null));
    api.financeEntries(month).then(setEntries).catch(() => setEntries([]));
    api.openAccounts().then(setOpen).catch(() => setOpen([]));
  }
  useEffect(load, [month]);

  return (
    <Page>
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          eyebrow="GESTÃO · FLUXO DE CAIXA"
          title="Financeiro"
          subtitle="Receitas de vendas entram automaticamente dos pedidos pagos. Registre despesas e outras receitas para ver o saldo do mês."
        />
        <div className="mt-2 flex shrink-0 gap-2">
          <Button variant="outline" onClick={() => downloadCashflowCsv(month)}><Download className="h-4 w-4" /> CSV</Button>
          <Button onClick={() => setAdding((v) => !v)}><Plus className="h-4 w-4" /> Lançamento</Button>
        </div>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <Button variant="outline" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="min-w-[180px] text-center font-medium capitalize">{monthLabel(month)}</span>
        <Button variant="outline" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= thisMonth()}><ChevronRight className="h-4 w-4" /></Button>
      </div>

      {!cf ? <Skeleton className="h-28" /> : (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Receitas" value={formatBRL(cf.receitasBRL)} Icon={TrendingUp} />
          <StatCard label="Despesas" value={formatBRL(cf.despesasBRL)} Icon={TrendingDown} alert={cf.despesasBRL > cf.receitasBRL} />
          <StatCard label="Saldo do mês" value={formatBRL(cf.saldoBRL)} Icon={Wallet} alert={cf.saldoBRL < 0} />
          <StatCard label={`Vendas (${cf.ordersCount})`} value={formatBRL(cf.vendasBRL)} Icon={ShoppingBag} />
        </div>
      )}

      {adding && <NovoLancamento onDone={() => { setAdding(false); load(); }} />}

      {open && open.length > 0 && (
        <Card className="mb-6 border-amber-200 bg-amber-50/40">
          <CardHeader
            icon={CalendarClock}
            title="Contas em aberto"
            subtitle={cf ? `A pagar ${formatBRL(cf.aPagarBRL)} · a receber ${formatBRL(cf.aReceberBRL)}${cf.vencidasBRL > 0 ? ` · ${formatBRL(cf.vencidasBRL)} vencido` : ""}` : undefined}
          />
          <div className="divide-y divide-border/60">
            {open.map((e) => (
              <div key={e.id} className="flex items-center gap-3 p-4">
                {e.overdue ? <AlertTriangle className="h-4 w-4 text-primary" /> : <CalendarClock className="h-4 w-4 text-muted-foreground" />}
                <div className="min-w-0">
                  <p className="font-medium capitalize text-foreground">{e.category}{e.description ? <span className="font-normal text-muted-foreground"> · {e.description}</span> : ""}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.type === "despesa" ? "a pagar" : "a receber"}
                    {e.dueDate ? ` · vence ${new Date(e.dueDate).toLocaleDateString("pt-BR")}` : ""}
                    {e.overdue ? " · vencida" : ""}
                  </p>
                </div>
                <span className={`ml-auto font-medium ${e.type === "despesa" ? "text-primary" : "text-emerald-600"}`}>{formatBRL(e.amountBRL)}</span>
                <Button variant="outline" onClick={() => api.payFinanceEntry(e.id).then(load)}><CheckCircle2 className="h-4 w-4" /> Baixar</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {cf && cf.byCategory.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Por categoria" subtitle="Lançamentos manuais agrupados (vendas não entram aqui)." />
          <div className="space-y-2 px-5 pb-5">
            {cf.byCategory.map((c) => (
              <div key={`${c.type}:${c.category}`} className="flex items-center gap-3 text-sm">
                <Badge tone={c.type === "despesa" ? "danger" : "success"}>{c.type}</Badge>
                <span className="capitalize text-foreground">{c.category}</span>
                <span className={`ml-auto font-medium ${c.type === "despesa" ? "text-primary" : "text-emerald-600"}`}>{formatBRL(c.totalBRL)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!entries ? <Skeleton className="h-40" />
        : entries.length === 0 ? <EmptyState icon={Wallet} title="Sem lançamentos" description="Registre despesas e receitas do mês no botão “Lançamento”." />
        : (
          <Card>
            <div className="divide-y divide-border/60">
              {entries.map((e) => (
                <div key={e.id} className="flex items-center gap-3 p-4">
                  {e.type === "despesa" ? <TrendingDown className="h-4 w-4 text-primary" /> : <TrendingUp className="h-4 w-4 text-emerald-600" />}
                  <div className="min-w-0">
                    <p className="font-medium capitalize text-foreground">{e.category}{e.description ? <span className="font-normal text-muted-foreground"> · {e.description}</span> : ""}</p>
                    <p className="text-xs text-muted-foreground">{new Date(e.date).toLocaleDateString("pt-BR")}</p>
                  </div>
                  <span className={`ml-auto font-medium ${e.type === "despesa" ? "text-primary" : "text-emerald-600"}`}>
                    {e.type === "despesa" ? "−" : "+"}{formatBRL(e.amountBRL)}
                  </span>
                  <button onClick={() => api.deleteFinanceEntry(e.id).then(load)} className="text-muted-foreground hover:text-primary"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          </Card>
        )}
    </Page>
  );
}

function NovoLancamento({ onDone }: { onDone: () => void }) {
  const [type, setType] = useState<"receita" | "despesa">("despesa");
  const [category, setCategory] = useState("fornecedor");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [pendente, setPendente] = useState(false);
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const cats = type === "despesa" ? DESPESA_CATS : RECEITA_CATS;

  async function save() {
    setErr("");
    const amt = Number(amount.replace(",", "."));
    if (!amt || amt <= 0) { setErr("Informe um valor válido."); return; }
    setSaving(true);
    try {
      await api.createFinanceEntry({
        type, category, description: description || undefined, amountBRL: amt, date,
        status: pendente ? "pendente" : "pago",
        dueDate: pendente ? dueDate : undefined,
      });
      onDone();
    } catch (e: any) { setErr(e?.message ?? "falha ao salvar"); }
    finally { setSaving(false); }
  }

  return (
    <Card className="mb-6">
      <CardHeader title="Novo lançamento" />
      <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
        {err && <div className="md:col-span-2 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>}
        <div className="flex gap-2">
          {(["despesa", "receita"] as const).map((t) => (
            <button key={t} type="button" onClick={() => { setType(t); setCategory(t === "despesa" ? DESPESA_CATS[0]! : RECEITA_CATS[0]!); }}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize transition-colors ${type === t ? "border-primary bg-accent-soft text-primary-strong" : "border-border text-muted-foreground hover:bg-muted/60"}`}>
              {t}
            </button>
          ))}
        </div>
        <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
          {cats.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
        </select>
        <input className={inputClass} placeholder="Valor (R$)" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        <input className={inputClass} type="date" value={pendente ? dueDate : date} onChange={(e) => (pendente ? setDueDate : setDate)(e.target.value)} title={pendente ? "Vencimento" : "Data de caixa"} />
        <input className={`${inputClass} md:col-span-2`} placeholder="Descrição (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" checked={pendente} onChange={(e) => setPendente(e.target.checked)} />
          É uma conta {type === "despesa" ? "a pagar" : "a receber"} (pendente) — a data acima vira o vencimento.
        </label>
        <div className="md:col-span-2">
          <Button onClick={save} disabled={saving}><Plus className="h-4 w-4" /> {saving ? "Salvando…" : "Adicionar"}</Button>
        </div>
      </div>
    </Card>
  );
}
