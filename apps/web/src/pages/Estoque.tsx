import { useState } from "react";
import { Barcode, Search, Tag, PackagePlus, Image as ImageIcon } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { api, downloadLabels, type StockTrace, type BarcodeByPhoto } from "../lib/api";

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
  const [labelMsg, setLabelMsg] = useState<string | null>(null);
  const [entryBarcode, setEntryBarcode] = useState("");
  const [entryQty, setEntryQty] = useState("1");
  const [entryType, setEntryType] = useState<"receive" | "adjust_in" | "adjust_out">("receive");
  const [entryMsg, setEntryMsg] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoRes, setPhotoRes] = useState<BarcodeByPhoto | null>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

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

  async function lancarEntrada() {
    setEntryMsg(null);
    const bc = entryBarcode.trim();
    const qty = Number(entryQty);
    if (!bc) { setEntryMsg("Bipe o código."); return; }
    if (!Number.isInteger(qty) || qty <= 0) { setEntryMsg("Quantidade inválida."); return; }
    try {
      if (entryType === "receive") await api.stockReceive(bc, qty);
      else await api.stockAdjust(bc, entryType, qty);
      setEntryMsg("Lançado ✓");
      setEntryBarcode(""); setEntryQty("1");
      if (trace?.barcode === bc) lookup(bc); // atualiza o histórico se for o mesmo código
    } catch (e: any) {
      setEntryMsg(/404/.test(String(e)) ? "Código não encontrado." : String(e?.message ?? e));
    }
  }

  async function buscarPorFoto() {
    const url = photoUrl.trim();
    if (!url) return;
    setPhotoBusy(true); setPhotoErr(null); setPhotoRes(null);
    try {
      setPhotoRes(await api.barcodesByPhoto([url]));
    } catch (e: any) {
      setPhotoErr(/422/.test(String(e)) ? "Não consegui analisar a foto (visão indisponível?)." : String(e?.message ?? e));
    } finally { setPhotoBusy(false); }
  }

  async function baixarEtiquetas(format: "csv" | "zpl") {
    setLabelMsg(null);
    try {
      const r = await downloadLabels(format);
      setLabelMsg(`Arquivo ${format.toUpperCase()} gerado${r.missing ? ` (${r.missing} sem código, ignorados)` : ""}.`);
    } catch (e: any) { setLabelMsg(`Erro: ${e?.message ?? e}`); }
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

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button onClick={backfill} className="text-xs text-muted-foreground underline hover:text-foreground">
          Gerar/sincronizar códigos do catálogo
        </button>
        {backfillMsg && <span className="text-xs text-muted-foreground">{backfillMsg}</span>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-4">
        <Tag size={16} className="text-muted-foreground" />
        <span className="text-sm font-medium">Arquivo de etiquetas (fornecedor)</span>
        <button onClick={() => baixarEtiquetas("csv")}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
          Baixar CSV
        </button>
        <button onClick={() => baixarEtiquetas("zpl")}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
          Baixar ZPL (Zebra)
        </button>
        {labelMsg && <span className="text-xs text-muted-foreground">{labelMsg}</span>}
      </div>

      <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
          <PackagePlus size={16} className="text-muted-foreground" /> Entrada / ajuste de estoque
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={entryType} onChange={(e) => setEntryType(e.target.value as any)}
            className="rounded-md border border-border bg-background px-2 py-2 text-sm">
            <option value="receive">Recebimento (fornecedor)</option>
            <option value="adjust_in">Ajuste + (balanço)</option>
            <option value="adjust_out">Ajuste − (quebra/perda)</option>
          </select>
          <input
            value={entryBarcode}
            onChange={(e) => setEntryBarcode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lancarEntrada()}
            placeholder="Código de barras…"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <input
            type="number" min={1} value={entryQty} onChange={(e) => setEntryQty(e.target.value)}
            className="w-20 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button onClick={lancarEntrada}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
            Lançar
          </button>
          {entryMsg && <span className="text-xs text-muted-foreground">{entryMsg}</span>}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
          <ImageIcon size={16} className="text-muted-foreground" /> Encontrar código pela foto da peça
        </p>
        <div className="flex gap-2">
          <input
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && buscarPorFoto()}
            placeholder="URL da foto da peça…"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button onClick={buscarPorFoto} disabled={photoBusy}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50">
            {photoBusy ? "Analisando…" : "Buscar"}
          </button>
        </div>
        {photoErr && <p className="mt-2 text-xs text-red-600">{photoErr}</p>}
        {photoRes && (
          <ul className="mt-3 space-y-2">
            {photoRes.candidatos.length === 0 && <li className="text-sm text-muted-foreground">Nenhum candidato.</li>}
            {photoRes.candidatos.map((c) => (
              <li key={c.productId} className="flex items-start gap-3 rounded-md border border-border bg-background p-3">
                {c.mainPhoto && <img src={c.mainPhoto} alt="" className="h-14 w-14 rounded object-cover" />}
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.name}</p>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {c.variantes.map((v) => (
                      <span key={v.sku}>{[v.color, v.size].filter(Boolean).join("/") || v.sku}: <b className="text-foreground">{v.barcode ?? "—"}</b></span>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}

      {trace && (
        <section className="mt-6 rounded-lg border border-border bg-background p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              {trace.photo && <img src={trace.photo} alt="" className="h-16 w-16 rounded object-cover" />}
              <div>
                <p className="font-medium">{trace.productName}</p>
                <p className="text-xs text-muted-foreground">{trace.variantSku} · {trace.barcode}</p>
              </div>
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
