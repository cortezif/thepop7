import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, fetchTvDashboard, type TvDashboard } from "../lib/api";
import { formatBRL } from "../lib/utils";

// Wallboard de TV (ADR-040). Tela cheia, tema escuro, fontes grandes para um
// monitor de 32". Atualiza sozinha a cada 12s. Modo público (/tv/:token) ou
// logado (/tv). Cores explícitas: não depende do tema do painel.

const REFRESH_MS = 12_000;

const STATUS_PT: Record<string, string> = {
  created: "Criado", paid: "Pago", picking: "Separação", shipped: "Enviado",
  in_transit: "Em trânsito", out_for_delivery: "Saiu p/ entrega",
  delivered: "Entregue", finalized: "Finalizado", canceled: "Cancelado",
};
const STATUS_COLOR: Record<string, string> = {
  created: "bg-amber-500/20 text-amber-300", paid: "bg-emerald-500/20 text-emerald-300",
  picking: "bg-sky-500/20 text-sky-300", shipped: "bg-sky-500/20 text-sky-300",
  in_transit: "bg-indigo-500/20 text-indigo-300", out_for_delivery: "bg-indigo-500/20 text-indigo-300",
  delivered: "bg-emerald-500/20 text-emerald-300", finalized: "bg-emerald-500/20 text-emerald-300",
  canceled: "bg-rose-500/20 text-rose-300",
};

function hhmmss(d: Date) { return d.toLocaleTimeString("pt-BR"); }
function hhmm(s: string) { return new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }

export function PainelTV() {
  const { token } = useParams();
  const [data, setData] = useState<TvDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const lastOk = useRef<number>(0);

  async function load() {
    try {
      const d = token ? await fetchTvDashboard(token) : await api.liveDashboard();
      setData(d); setError(null); lastOk.current = Date.now();
    } catch (e: any) { setError(e?.message ?? "falha ao carregar"); }
  }

  useEffect(() => {
    load();
    const poll = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const staleSecs = lastOk.current ? Math.floor((now.getTime() - lastOk.current) / 1000) : 0;

  if (error && !data) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-center text-slate-300">
        <div>
          <p className="text-2xl font-semibold text-rose-400">Não foi possível carregar o painel</p>
          <p className="mt-2 text-slate-400">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-2xl text-slate-400">Carregando painel…</div>;
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 px-8 py-6 text-white">
      {/* Cabeçalho */}
      <header className="flex shrink-0 items-end justify-between border-b border-white/10 pb-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-rose-400">Painel de vendas · ao vivo</p>
          <h1 className="font-serif text-4xl font-bold">{data.store}</h1>
        </div>
        <div className="text-right">
          <p className="font-mono text-5xl font-bold tabular-nums tracking-tight">{hhmmss(now)}</p>
          <p className="mt-1 flex items-center justify-end gap-2 text-sm text-slate-400">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${staleSecs < 20 ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
            atualizado há {staleSecs}s
          </p>
        </div>
      </header>

      {/* Métricas grandes */}
      <section className="grid shrink-0 grid-cols-4 gap-4 py-5">
        <Metric label="Vendas de hoje" value={formatBRL(data.today.salesBRL)} accent="emerald" big />
        <Metric label="Pedidos pagos" value={String(data.today.ordersPaid)} sub={`ticket ${formatBRL(data.today.ticketBRL)}`} accent="emerald" />
        <Metric label="Em atendimento" value={String(data.attendance.active)} sub={data.attendance.waitingHuman > 0 ? `${data.attendance.waitingHuman} aguardando humano` : "IA respondendo"} accent={data.attendance.waitingHuman > 0 ? "rose" : "sky"} pulse={data.attendance.waitingHuman > 0} />
        <Metric label="Novos pedidos hoje" value={String(data.today.newOrders)} accent="sky" />

        <Metric label="Aguardando aprovação" value={String(data.payments.pendingApproval)} accent={data.payments.pendingApproval > 0 ? "amber" : "slate"} pulse={data.payments.pendingApproval > 0} />
        <Metric label="A separar / postar" value={String(data.fulfillment.toShip)} accent={data.fulfillment.toShip > 0 ? "amber" : "slate"} />
        <Metric label="Em trânsito" value={String(data.fulfillment.inTransit)} accent="indigo" />
        <Metric label="Entregues hoje" value={String(data.fulfillment.deliveredToday)} accent="emerald" />
      </section>

      {/* Listas */}
      <section className="grid min-h-0 flex-1 grid-cols-3 gap-4">
        <Panel title="Últimos pedidos" className="col-span-1">
          {data.recentOrders.length === 0 ? <Empty /> : data.recentOrders.map((o, i) => (
            <Line key={i}
              left={<><span className="font-semibold">{o.customer}</span><span className="ml-2 text-slate-500">#{o.id}</span></>}
              mid={<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${o.pendingApproval ? "bg-amber-500/20 text-amber-300" : STATUS_COLOR[o.status] ?? "bg-slate-700 text-slate-300"}`}>{o.pendingApproval ? "Aprovar" : STATUS_PT[o.status] ?? o.status}</span>}
              right={<span className="font-mono font-semibold tabular-nums">{formatBRL(o.totalBRL)}</span>} />
          ))}
        </Panel>

        <Panel title="Em atendimento agora" className="col-span-1">
          {data.attendingNow.length === 0 ? <Empty text="Ninguém na fila" /> : data.attendingNow.map((c, i) => (
            <Line key={i}
              left={<><span className="font-semibold">{c.customer}</span><span className="ml-2 text-xs uppercase text-slate-500">{c.channel}</span></>}
              mid={c.waitingHuman ? <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs font-medium text-rose-300">precisa de gente</span> : <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-xs font-medium text-sky-300">com a IA</span>}
              right={<span className="text-sm text-slate-400">{hhmm(c.lastMessageAt)}</span>} />
          ))}
        </Panel>

        <Panel title="Entregas concluídas" className="col-span-1">
          {data.recentDeliveries.length === 0 ? <Empty text="Nenhuma entrega ainda" /> : data.recentDeliveries.map((d, i) => (
            <Line key={i}
              left={<span className="font-semibold">{d.customer}</span>}
              mid={<span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-300">entregue</span>}
              right={<span className="text-sm text-slate-400">{d.deliveredAt ? hhmm(d.deliveredAt) : "—"}</span>} />
          ))}
        </Panel>
      </section>
    </div>
  );
}

const ACCENTS: Record<string, string> = {
  emerald: "text-emerald-400", sky: "text-sky-400", indigo: "text-indigo-400",
  amber: "text-amber-400", rose: "text-rose-400", slate: "text-slate-300",
};

function Metric({ label, value, sub, accent = "slate", big, pulse }: {
  label: string; value: string; sub?: string; accent?: string; big?: boolean; pulse?: boolean;
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 px-6 py-5 ${pulse ? "ring-2 ring-rose-500/40" : ""}`}>
      <p className="text-sm font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-2 font-bold tabular-nums ${ACCENTS[accent]} ${big ? "text-6xl" : "text-5xl"}`}>{value}</p>
      {sub && <p className="mt-1 text-sm text-slate-400">{sub}</p>}
    </div>
  );
}

function Panel({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/5 ${className ?? ""}`}>
      <h2 className="shrink-0 border-b border-white/10 px-5 py-3 text-lg font-semibold text-slate-200">{title}</h2>
      <div className="min-h-0 flex-1 divide-y divide-white/5 overflow-hidden px-5">{children}</div>
    </div>
  );
}

function Line({ left, mid, right }: { left: React.ReactNode; mid?: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 text-lg">
      <div className="min-w-0 flex-1 truncate">{left}</div>
      {mid && <div className="shrink-0">{mid}</div>}
      <div className="shrink-0 text-right">{right}</div>
    </div>
  );
}

function Empty({ text = "Sem registros ainda" }: { text?: string }) {
  return <p className="py-8 text-center text-slate-500">{text}</p>;
}
