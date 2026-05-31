import { useEffect, useState } from "react";
import { Wallet, TrendingUp, TrendingDown, Plus, Trash2, ChevronLeft, ChevronRight, ShoppingBag, Download, AlertTriangle, CheckCircle2, CalendarClock } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { Page, Card, CardHeader, Button, Badge, EmptyState, Skeleton, inputClass } from "../components/ui";
import { api, downloadCashflowCsv, type Cashflow, type FinanceEntry, type OpenAccount, type FinanceTrendPoint } from "../lib/api";
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

      <FinanceTrend />

      {cf && <Dre cf={cf} />}

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

function shortMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y!, mo! - 1, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
}

function FinanceTrend() {
  const [t, setT] = useState<FinanceTrendPoint[] | null>(null);
  useEffect(() => { api.financeTrend().then(setT).catch(() => setT(null)); }, []);
  if (!t) return null;
  const max = Math.max(1, ...t.map((p) => Math.max(p.receitasBRL, p.despesasBRL)));
  return (
    <Card className="mb-6">
      <CardHeader title="Evolução do caixa (6 meses)" subtitle="Receitas (verde) vs despesas (vermelho) realizadas por mês; saldo abaixo." />
      <div className="mt-6 flex items-end justify-between gap-3 px-5" style={{ height: 160 }}>
        {t.map((p) => (
          <div key={p.month} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-[110px] w-full items-end justify-center gap-1">
              <div className="w-1/3 rounded-t bg-emerald-500/80" style={{ height: `${Math.round((p.receitasBRL / max) * 100)}%` }} title={`Receitas ${formatBRL(p.receitasBRL)}`} />
              <div className="w-1/3 rounded-t bg-primary/70" style={{ height: `${Math.round((p.despesasBRL / max) * 100)}%` }} title={`Despesas ${formatBRL(p.despesasBRL)}`} />
            </div>
            <span className={`text-[11px] font-medium ${p.saldoBRL < 0 ? "text-primary" : "text-emerald-700"}`}>{p.saldoBRL ? formatBRL(p.saldoBRL) : "—"}</span>
            <span className="text-[10px] uppercase text-muted-foreground">{shortMonth(p.month)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Dre({ cf }: { cf: Cashflow }) {
  const receitasCats = cf.byCategory.filter((c) => c.type === "receita");
  const despesasCats = cf.byCategory.filter((c) => c.type === "despesa");
  return (
    <Card className="mb-6">
      <CardHeader title="Demonstrativo do mês (DRE simplificado)" subtitle="Resultado por categoria, das receitas às despesas." />
      <div className="space-y-1.5 px-5 pb-5 text-sm">
        <Linha label="Vendas (pedidos pagos)" value={cf.vendasBRL} />
        {receitasCats.map((c) => <Linha key={c.category} label={`Receita · ${c.category}`} value={c.totalBRL} indent />)}
        <Linha label="= Total de receitas" value={cf.receitasBRL} bold />
        <div className="h-2" />
        {despesasCats.length === 0 && <p className="text-muted-foreground">Sem despesas lançadas.</p>}
        {despesasCats.map((c) => <Linha key={c.category} label={`Despesa · ${c.category}`} value={-c.totalBRL} indent />)}
        <Linha label="= Total de despesas" value={-cf.despesasBRL} bold />
        <div className="my-2 border-t border-border" />
        <Linha label="= Resultado do mês" value={cf.saldoBRL} bold big />
      </div>
    </Card>
  );
}

function Linha({ label, value, bold, indent, big }: { label: string; value: number; bold?: boolean; indent?: boolean; big?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold text-foreground" : "text-muted-foreground"} ${indent ? "pl-4" : ""} ${big ? "text-base" : ""}`}>
      <span className="capitalize">{label}</span>
      <span className={value < 0 ? "text-primary" : value > 0 ? "text-emerald-600" : ""}>{formatBRL(value)}</span>
    </div>
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
