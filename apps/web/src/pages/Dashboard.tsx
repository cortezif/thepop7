import { useEffect, useState } from "react";
import { TrendingUp, MessageCircle, Bot, Coins, Package, UserCheck, Wallet, Filter, AlertTriangle, FileWarning, Sparkles, Gauge } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { Page, Card, CardHeader, Badge } from "../components/ui";
import { api, type DailyMetrics } from "../lib/api";
import { formatBRL } from "../lib/utils";

export function Dashboard() {
  const [m, setM] = useState<DailyMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.dailyMetrics().then(setM).catch((e) => setError(String(e)));
  }, []);

  return (
    <Page>
      <PageHeader
        eyebrow="PAINEL"
        title="Visão geral"
        subtitle="O pulso da sua loja em um só lugar — atendimento, margem real, conversão e a inteligência cuidando do dia a dia."
      />

      {error && (
        <div className="mb-6 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>Erro: {error}</p>
        </div>
      )}

      {m && m.budget.level !== "ok" && (
        <div className={`mb-6 flex items-start gap-3 rounded-xl border px-4 py-3.5 text-sm shadow-soft ${
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

      {/* Métricas do dia */}
      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-luxe text-muted-foreground">Hoje</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Conversas hoje"       value={m ? String(m.conversationsToday) : "…"} Icon={MessageCircle} />
          <StatCard label="Mensagens da IA hoje" value={m ? String(m.aiMessagesToday) : "…"} Icon={Bot} />
          <StatCard label="Custo IA hoje"        value={m ? formatBRL(m.aiCostTodayBRL) : "…"} Icon={Coins} />
          <StatCard label="Resolvido por IA"     value={m ? `${m.resolvedByAIPct}%` : "…"} Icon={UserCheck} />
        </div>
      </section>

      {/* Estado do atendimento */}
      <section className="mt-8 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-luxe text-muted-foreground">Atendimento</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Conversas ativas"     value={m ? String(m.activeConversations) : "…"} Icon={MessageCircle} />
          <StatCard label="Em atendimento humano" value={m ? String(m.handedOff) : "…"} Icon={UserCheck} />
          <StatCard label="Custo médio/conversa"  value={m ? formatBRL(m.avgCostPerConversationBRL) : "…"} Icon={TrendingUp} />
          <StatCard label="Msgs a revisar (IA)"   value={m ? String(m.flaggedForReview) : "…"} Icon={AlertTriangle} />
          <StatCard label="NF-e pendentes"        value={m ? String(m.nfePending) : "…"} Icon={FileWarning} alert={!!m && m.nfePending > 0} />
        </div>
      </section>

      {/* Margem real (ADR-017) — receita − COGS − frete − gateway */}
      {m && (
        <Card className="mt-8">
          <CardHeader
            icon={Wallet}
            title="Margem real"
            subtitle="Receita de produtos − custo (COGS) − taxa de gateway + resultado de frete (cobrado − pago à transportadora)."
            action={<Badge tone="accent">{m.financials.realizedOrders} pedido(s)</Badge>}
          />

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard label="Margem líquida" value={formatBRL(m.financials.netMarginBRL)} Icon={TrendingUp} />
            <StatCard label="Margem %" value={`${m.financials.netMarginPct}%`} Icon={Gauge} />
            <StatCard label="Receita bruta" value={formatBRL(m.financials.grossRevenueBRL)} Icon={Coins} />
          </div>

          <div className="mt-6 rounded-lg border border-border bg-muted/30 p-5">
            <div className="space-y-2 text-sm">
              <MarginRow label="Receita de produtos (subtotal)" value={m.financials.subtotalBRL} />
              <MarginRow label="− Custo dos produtos (COGS)" value={-m.financials.cogsBRL} />
              <MarginRow label="− Taxa de gateway" value={-m.financials.gatewayFeesBRL} />
              <MarginRow label="± Resultado de frete" value={m.financials.shippingResultBRL} />
              <div className="my-2 border-t border-border" />
              <MarginRow label="= Margem líquida" value={m.financials.netMarginBRL} bold />
            </div>
            <p className="pt-3 text-xs text-muted-foreground">
              Frete cobrado {formatBRL(m.financials.shippingBRL)} − pago {formatBRL(m.financials.shippingCostBRL)} = {formatBRL(m.financials.shippingResultBRL)}.
            </p>
          </div>

          {m.financials.ordersMissingCost > 0 && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-700">
              {m.financials.ordersMissingCost} pedido(s) têm itens sem custo cadastrado — a margem está superestimada. Cadastre o custo no catálogo.
            </p>
          )}
          {m.financials.ordersMissingShippingCost > 0 && (
            <p className="mt-2 rounded-lg bg-muted/60 px-3.5 py-2.5 text-xs text-muted-foreground">
              {m.financials.ordersMissingShippingCost} pedido(s) sem custo de frete informado — tratados como pass-through. Registre a fatura da transportadora no pedido.
            </p>
          )}
        </Card>
      )}

      {/* NPS + Funil lado a lado em telas largas */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* NPS (ADR-017) */}
        {m && (
          <Card>
            <CardHeader
              icon={Sparkles}
              title="NPS"
              subtitle="Promotores (9-10) − detratores (0-6). Produto e atendimento separados."
            />
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {([["Geral", m.nps.geral], ["Produto", m.nps.produto], ["Atendimento", m.nps.atendimento]] as const).map(([label, s]) => (
                <div key={label} className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className={`mt-1.5 font-serif text-3xl font-semibold leading-none ${s.score >= 50 ? "text-emerald-600" : s.score < 0 ? "text-primary" : "text-foreground"}`}>
                    {s.responses ? s.score : "—"}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {s.responses} resposta(s){s.responses ? ` · ${s.promotores}P / ${s.neutros}N / ${s.detratores}D` : ""}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Funil de conversão (ADR-017) */}
        {m && (
          <Card>
            <CardHeader
              icon={Filter}
              title="Funil de conversão"
              subtitle="Da primeira conversa à entrega. O % ao lado é a conversão a partir da etapa anterior."
              action={<Badge tone="accent">conversa → pedido {m.funnel.overallConversionPct}%</Badge>}
            />
            <div className="mt-6 space-y-2.5">
              {m.funnel.stages.map((s, i) => {
                const top = m.funnel.stages[0]?.count || 1;
                const width = Math.max(4, Math.round((s.count / top) * 100));
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 text-sm font-medium text-foreground">{s.label}</span>
                    <div className="h-6 flex-1 overflow-hidden rounded-md bg-muted">
                      <div className="flex h-full items-center rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-all" style={{ width: `${width}%` }}>
                        {s.count}
                      </div>
                    </div>
                    <span className="w-12 text-right text-xs text-muted-foreground">
                      {i === 0 ? "—" : `${s.rateFromPrev}%`}
                    </span>
                  </div>
                );
              })}
            </div>
            {m.funnel.ordersCanceled > 0 && (
              <p className="mt-4 text-xs text-muted-foreground">
                {m.funnel.ordersCanceled} pedido(s) cancelado(s) (fora do funil).
              </p>
            )}
          </Card>
        )}
      </div>

      {/* Distribuição de modelos — mostra o smart routing economizando */}
      {m && Object.keys(m.modelDistribution).length > 0 && (
        <Card className="mt-6">
          <CardHeader
            icon={Bot}
            title="Distribuição de modelos hoje"
            subtitle="Smart routing escolhe o modelo certo por intenção — Haiku pra trivial, Sonnet pra venda/reclamação."
          />
          <div className="mt-6 space-y-2.5">
            {Object.entries(m.modelDistribution).map(([model, count]) => {
              const total = Object.values(m.modelDistribution).reduce((a, b) => a + b, 0);
              const pct = Math.round((count / total) * 100);
              return (
                <div key={model} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 text-sm font-medium text-foreground">{model}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded-md bg-muted">
                    <div className="h-full rounded-md bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-20 text-right text-sm text-muted-foreground">{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Rodapé — totais acumulados */}
      <Card className="mt-6 bg-muted/30" padded={false}>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-primary">
              <Coins size={17} />
            </span>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Custo total acumulado de IA</p>
              <p className="font-serif text-lg font-semibold text-foreground">{m ? formatBRL(m.aiCostTotalBRL) : "…"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:border-l sm:border-border sm:pl-6">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-primary">
              <MessageCircle size={17} />
            </span>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Total de conversas</p>
              <p className="font-serif text-lg font-semibold text-foreground">{m ? m.totalConversations : "…"}</p>
            </div>
          </div>
        </div>
      </Card>
    </Page>
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
