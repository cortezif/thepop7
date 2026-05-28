import { useEffect, useState } from "react";
import { TrendingUp, MessageCircle, Bot, Coins, Package, UserCheck, Wallet, Filter, AlertTriangle } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { api, type DailyMetrics } from "../lib/api";
import { formatBRL } from "../lib/utils";

export function Dashboard() {
  const [m, setM] = useState<DailyMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.dailyMetrics().then(setM).catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="mx-auto max-w-6xl p-10">
      <PageHeader eyebrow="PAINEL" title="Visão geral" />
      {error && <p className="mt-4 text-sm text-primary">Erro: {error}</p>}

      {m && m.budget.level !== "ok" && (
        <div className={`mt-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
          m.budget.level === "over" ? "border-primary/40 bg-primary/10 text-primary" : "border-amber-300 bg-amber-50 text-amber-700"
        }`}>
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">
              {m.budget.level === "over" ? "Orçamento de IA estourado" : "Orçamento de IA quase no limite"}
            </p>
            <p className="text-xs">
              {formatBRL(m.budget.monthCostBRL)} de {formatBRL(m.budget.monthlyBudgetBRL)} usados este mês ({m.budget.pctUsed}%).
              {m.budget.level === "over" && " Considere pausar a IA ou aumentar o limite em Configurações."}
            </p>
          </div>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Conversas hoje"       value={m ? String(m.conversationsToday) : "…"} Icon={MessageCircle} />
        <StatCard label="Mensagens da IA hoje" value={m ? String(m.aiMessagesToday) : "…"} Icon={Bot} />
        <StatCard label="Custo IA hoje"        value={m ? formatBRL(m.aiCostTodayBRL) : "…"} Icon={Coins} />
        <StatCard label="Resolvido por IA"     value={m ? `${m.resolvedByAIPct}%` : "…"} Icon={UserCheck} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Conversas ativas"     value={m ? String(m.activeConversations) : "…"} Icon={MessageCircle} />
        <StatCard label="Em atendimento humano" value={m ? String(m.handedOff) : "…"} Icon={UserCheck} />
        <StatCard label="Custo médio/conversa"  value={m ? formatBRL(m.avgCostPerConversationBRL) : "…"} Icon={TrendingUp} />
        <StatCard label="Catálogo enriquecido"  value={m ? `${m.productsEnriched}/${m.productsTotal}` : "…"} Icon={Package} />
      </div>

      {/* Margem real (ADR-017) — receita − COGS − frete − gateway */}
      {m && (
        <div className="mt-8 rounded-lg border border-border bg-background p-6">
          <div className="flex items-center gap-2">
            <Wallet size={18} className="text-primary" />
            <h2 className="font-serif text-lg font-bold">Margem real</h2>
            <span className="text-xs text-muted-foreground">
              · {m.financials.realizedOrders} pedido(s) realizado(s)
            </span>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            Receita de produtos − custo (COGS) − taxa de gateway. Frete tratado como pass-through.
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard label="Margem líquida" value={formatBRL(m.financials.netMarginBRL)} Icon={TrendingUp} />
            <StatCard label="Margem %" value={`${m.financials.netMarginPct}%`} Icon={TrendingUp} />
            <StatCard label="Receita bruta" value={formatBRL(m.financials.grossRevenueBRL)} Icon={Coins} />
          </div>

          <div className="mt-4 space-y-1.5 text-sm">
            <MarginRow label="Receita de produtos (subtotal)" value={m.financials.subtotalBRL} />
            <MarginRow label="− Custo dos produtos (COGS)" value={-m.financials.cogsBRL} />
            <MarginRow label="− Taxa de gateway" value={-m.financials.gatewayFeesBRL} />
            <div className="my-1 border-t border-border" />
            <MarginRow label="= Margem líquida" value={m.financials.netMarginBRL} bold />
            <p className="pt-1 text-xs text-muted-foreground">
              Frete cobrado {formatBRL(m.financials.shippingBRL)} (pass-through, não entra na margem).
            </p>
          </div>

          {m.financials.ordersMissingCost > 0 && (
            <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {m.financials.ordersMissingCost} pedido(s) têm itens sem custo cadastrado — a margem está superestimada. Cadastre o custo no catálogo.
            </p>
          )}
        </div>
      )}

      {/* Funil de conversão (ADR-017) */}
      {m && (
        <div className="mt-6 rounded-lg border border-border bg-background p-6">
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-primary" />
            <h2 className="font-serif text-lg font-bold">Funil de conversão</h2>
            <span className="text-xs text-muted-foreground">
              · conversa → pedido: {m.funnel.overallConversionPct}%
            </span>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            Da primeira conversa à entrega. O % ao lado é a conversão a partir da etapa anterior.
          </p>
          <div className="space-y-2">
            {m.funnel.stages.map((s, i) => {
              const top = m.funnel.stages[0]?.count || 1;
              const width = Math.max(4, Math.round((s.count / top) * 100));
              return (
                <div key={s.key} className="flex items-center gap-3">
                  <span className="w-36 text-sm font-medium">{s.label}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-muted">
                    <div className="flex h-full items-center rounded bg-primary px-2 text-xs font-medium text-primary-foreground" style={{ width: `${width}%` }}>
                      {s.count}
                    </div>
                  </div>
                  <span className="w-16 text-right text-xs text-muted-foreground">
                    {i === 0 ? "—" : `${s.rateFromPrev}%`}
                  </span>
                </div>
              );
            })}
          </div>
          {m.funnel.ordersCanceled > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {m.funnel.ordersCanceled} pedido(s) cancelado(s) (fora do funil).
            </p>
          )}
        </div>
      )}

      {/* Distribuição de modelos — mostra o smart routing economizando */}
      {m && Object.keys(m.modelDistribution).length > 0 && (
        <div className="mt-8 rounded-lg border border-border bg-background p-6">
          <h2 className="font-serif text-lg font-bold">Distribuição de modelos hoje</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Smart routing escolhe o modelo certo por intenção — Haiku pra trivial, Sonnet pra venda/reclamação.
          </p>
          <div className="space-y-2">
            {Object.entries(m.modelDistribution).map(([model, count]) => {
              const total = Object.values(m.modelDistribution).reduce((a, b) => a + b, 0);
              const pct = Math.round((count / total) * 100);
              return (
                <div key={model} className="flex items-center gap-3">
                  <span className="w-40 text-sm font-medium">{model}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-muted">
                    <div className="h-full rounded bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-16 text-right text-sm text-muted-foreground">{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border bg-muted/30 p-5 text-sm text-muted-foreground">
        Custo total acumulado de IA: <span className="font-semibold text-foreground">{m ? formatBRL(m.aiCostTotalBRL) : "…"}</span>
        {"  ·  "}
        Total de conversas: <span className="font-semibold text-foreground">{m ? m.totalConversations : "…"}</span>
      </div>
    </div>
  );
}

function MarginRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className={value < 0 ? "text-primary" : ""}>{formatBRL(value)}</span>
    </div>
  );
}
