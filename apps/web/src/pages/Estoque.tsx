import { useState } from "react";
import { Barcode, Search } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { api, type StockTrace } from "../lib/api";

const TYPE_LABEL: Record<string, string> = {
  purchase_in: "Entrada (compra)",
  sale_out: "Saída (venda)",
  return_in: "Devolução (reentrada)",
  adjust_in: "Ajuste +",
  adjust_out: "Ajuste −",
};
const IS_IN = (t: string) => ["purchase_in", "return_in", "adjust_in"].includes(t);

export function Estoque() {
  const [code, setCode] = useState("");
  const [trace, setTrace] = useState<StockTrace | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);

  async function lookup(c?: string) {
    const q = (c ?? code).trim();
    if (!q) return;
    setBusy(true); setErr(null); setTrace(null);
    try {
      setTrace(await api.stockTrace(q));
    } catch (e: any) {
      setErr(/404/.test(String(e)) ? "Código não encontrado." : String(e?.message ?? e));
    } finally { setBusy(false); }
  }

  async function backfill() {
    setBackfillMsg(null);
    try {
      const r = await api.backfillBarcodes();
      setBackfillMsg(`${r.variantes} variantes — ${r.jaTinham} já tinham, ${r.gerados} gerados.`);
    } catch (e: any) { setBackfillMsg(`Erro: ${e?.message ?? e}`); }
  }

  return (
    <div className="mx-auto max-w-4xl p-10">
      <PageHeader eyebrow="ESTOQUE" title="Código de barras & rastreabilidade" />

      <div className="mt-4 flex gap-2">
        <div className="relative flex-1">
          <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
            placeholder="Bipe ou digite o código de barras…"
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <button onClick={() => lookup()} disabled={busy}
          className="flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50">
          <Search size={15} /> {busy ? "Buscando…" : "Rastrear"}
        </button>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <button onClick={backfill} className="text-xs text-muted-foreground underline hover:text-foreground">
          Gerar/sincronizar códigos do catálogo
        </button>
        {backfillMsg && <span className="text-xs text-muted-foreground">{backfillMsg}</span>}
      </div>

      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}

      {trace && (
        <section className="mt-6 rounded-lg border border-border bg-background p-6">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="font-medium">{trace.productName}</p>
              <p className="text-xs text-muted-foreground">{trace.variantSku} · {trace.barcode}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Saldo (razão)</p>
              <p className={cnSaldo(trace.saldoRazao)}>{trace.saldoRazao}</p>
            </div>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Movimentações</p>
            {trace.movimentos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem movimentações registradas.</p>
            ) : (
              <ul className="divide-y divide-border">
                {trace.movimentos.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span className={IS_IN(m.type) ? "text-emerald-600" : "text-red-600"}>
                        {IS_IN(m.type) ? "+" : "−"}{m.quantity}
                      </span>
                      <span>{TYPE_LABEL[m.type] ?? m.type}</span>
                      {m.refType && <span className="text-xs text-muted-foreground">({m.refType})</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(m.at).toLocaleString("pt-BR")} · {m.actor}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function cnSaldo(v: number) {
  return `text-2xl font-bold ${v < 0 ? "text-red-600" : "text-foreground"}`;
}
