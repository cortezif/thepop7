import { useEffect, useState } from "react";
import { Smile, Meh, Frown, Sparkles } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { Page, Card, CardHeader, Badge, EmptyState, Skeleton, Tabs } from "../components/ui";
import { api, type NpsBoard, type NpsBand } from "../lib/api";

type Filter = "todos" | NpsBand;

const BAND_META: Record<NpsBand, { label: string; cls: string; Icon: typeof Smile }> = {
  promotor: { label: "Promotor", cls: "text-emerald-600", Icon: Smile },
  neutro: { label: "Neutro", cls: "text-amber-600", Icon: Meh },
  detrator: { label: "Detrator", cls: "text-primary", Icon: Frown },
};

function monthLabel(m: string): string {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
}

export function Satisfacao() {
  const [filter, setFilter] = useState<Filter>("todos");
  const [board, setBoard] = useState<NpsBoard | null>(null);

  useEffect(() => {
    setBoard(null);
    api.npsBoard(filter === "todos" ? undefined : filter).then(setBoard).catch(() => setBoard(null));
  }, [filter]);

  return (
    <Page>
      <PageHeader
        eyebrow="PÓS-VENDA · NPS"
        title="Satisfação"
        subtitle="Net Promoter Score: promotores (9-10) menos detratores (0-6). Detratores são escalados automaticamente pra atendimento humano recuperar o cliente."
      />

      {!board ? <Skeleton className="h-40" /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
            <StatCard label="NPS geral" value={board.summary.geral.responses ? String(board.summary.geral.score) : "—"} Icon={Sparkles} />
            <StatCard label="Produto" value={board.summary.produto.responses ? String(board.summary.produto.score) : "—"} Icon={Smile} />
            <StatCard label="Atendimento" value={board.summary.atendimento.responses ? String(board.summary.atendimento.score) : "—"} Icon={Meh} />
          </div>

          <Card className="mb-6">
            <CardHeader icon={Sparkles} title="Tendência (6 meses)" subtitle="NPS por mês — barras acima de zero são saldo positivo de promotores." />
            <div className="mt-6 flex items-end justify-between gap-2" style={{ height: 140 }}>
              {board.trend.map((p) => {
                const h = Math.round((Math.abs(p.score) / 100) * 60);
                const pos = p.score >= 0;
                return (
                  <div key={p.month} className="flex flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-[10px] text-muted-foreground">{p.responses ? p.score : ""}</span>
                    <div className="flex h-[120px] w-full flex-col items-center justify-center">
                      <div className="flex w-full flex-1 items-end justify-center">
                        {pos && <div className="w-6 rounded-t bg-emerald-500/80" style={{ height: `${h}px` }} />}
                      </div>
                      <div className="h-px w-full bg-border" />
                      <div className="flex w-full flex-1 items-start justify-center">
                        {!pos && p.responses > 0 && <div className="w-6 rounded-b bg-primary/80" style={{ height: `${h}px` }} />}
                      </div>
                    </div>
                    <span className="text-[10px] uppercase text-muted-foreground">{monthLabel(p.month)}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="mb-4">
            <Tabs active={filter} onChange={setFilter} tabs={[
              { key: "todos", label: "Todos" },
              { key: "detrator", label: "Detratores", count: board.summary.geral.detratores },
              { key: "neutro", label: "Neutros" },
              { key: "promotor", label: "Promotores" },
            ]} />
          </div>

          {board.list.length === 0
            ? <EmptyState icon={Smile} title="Sem respostas" description="As notas chegam após o pós-venda D+14." />
            : (
              <Card>
                <div className="divide-y divide-border/60">
                  {board.list.map((r) => {
                    const meta = BAND_META[r.band];
                    return (
                      <div key={r.id} className="flex gap-3 p-4">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted/40 font-serif text-base font-semibold ${meta.cls}`}>{r.score}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{r.contactName ?? "Cliente"}</span>
                            <Badge tone="neutral">{meta.label}</Badge>
                            <span className="ml-auto text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("pt-BR")}</span>
                          </div>
                          {r.comment
                            ? <p className="mt-1 text-sm text-muted-foreground">{r.comment}</p>
                            : <p className="mt-1 text-sm italic text-muted-foreground/60">sem comentário</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
        </>
      )}
    </Page>
  );
}
