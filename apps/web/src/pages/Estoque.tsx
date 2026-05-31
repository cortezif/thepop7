import { useEffect, useState } from "react";
import { Barcode, Search, Tag, PackagePlus, Image as ImageIcon, History, ScanLine } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Page, Card, CardHeader, Button, Badge, EmptyState, Skeleton, inputClass } from "../components/ui";
import { api, downloadLabels, downloadPatternLabels, type StockTrace, type BarcodeByPhoto, type CodePattern, type GeneratedCode, type PiecesSummary } from "../lib/api";
import { DEFAULT_CLOTHING_PATTERN } from "@hubadvisor/shared/code-pattern";

const TYPE_LABEL: Record<string, string> = {
  purchase_in: "Entrada (compra)",
  sale_out: "Saída (venda)",
  return_in: "Devolução (reentrada)",
  adjust_in: "Ajuste +",
  adjust_out: "Ajuste −",
};
const IS_IN = (t: string) => ["purchase_in", "return_in", "adjust_in"].includes(t);
const TYPE_TONE: Record<string, "success" | "danger" | "info" | "warning" | "neutral"> = {
  purchase_in: "success",
  sale_out: "danger",
  return_in: "info",
  adjust_in: "warning",
  adjust_out: "neutral",
};

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

  async function buscarPorFoto(src?: string) {
    const img = (src ?? photoUrl).trim();
    if (!img) return;
    setPhotoBusy(true); setPhotoErr(null); setPhotoRes(null);
    try {
      setPhotoRes(await api.barcodesByPhoto([img]));
    } catch (e: any) {
      setPhotoErr(/422/.test(String(e)) ? "Não consegui analisar a foto (visão indisponível?)." : String(e?.message ?? e));
    } finally { setPhotoBusy(false); }
  }

  // Anexa foto do dispositivo (câmera/galeria): lê como data URL (base64) e busca.
  function onPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite reanexar o mesmo arquivo
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setPhotoErr("Imagem muito grande (máx. 8 MB)."); return; }
    const reader = new FileReader();
    reader.onload = () => { setPhotoUrl(""); buscarPorFoto(String(reader.result)); };
    reader.onerror = () => setPhotoErr("Não consegui ler a imagem.");
    reader.readAsDataURL(file);
  }

  async function baixarEtiquetas(format: "csv" | "zpl") {
    setLabelMsg(null);
    try {
      const r = await downloadLabels(format);
      setLabelMsg(`Arquivo ${format.toUpperCase()} gerado${r.missing ? ` (${r.missing} sem código, ignorados)` : ""}.`);
    } catch (e: any) { setLabelMsg(`Erro: ${e?.message ?? e}`); }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="ESTOQUE"
        title="Código de barras & rastreabilidade"
        subtitle="Bipe uma peça para rastrear saldo e histórico, lance entradas e gere etiquetas do ateliê."
      />

      {/* ── Scan / rastreio em destaque ─────────────────────────────────────── */}
      <Card className="bg-gradient-to-br from-card to-accent-soft/30">
        <CardHeader
          icon={ScanLine}
          title="Rastrear peça"
          subtitle="Bipe ou digite o código de barras para abrir o rastreio completo."
        />
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Barcode className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={17} />
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lookup()}
              placeholder="Bipe ou digite o código de barras…"
              className={`${inputClass} pl-10`}
            />
          </div>
          <Button onClick={() => lookup()} disabled={busy} Icon={Search} className="shrink-0">
            {busy ? "Buscando…" : "Rastrear"}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={backfill}>
            Gerar / sincronizar códigos do catálogo
          </Button>
          {backfillMsg && <span className="text-xs text-muted-foreground">{backfillMsg}</span>}
        </div>
      </Card>

      <PatternLabelGen />

      <PiecesStock />

      {/* ── Resultado de rastreio ──────────────────────────────────────────── */}
      {busy && (
        <Card className="mt-6">
          <div className="flex items-start gap-4">
            <Skeleton className="h-16 w-16 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-10 w-20" />
          </div>
          <div className="mt-6 space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </Card>
      )}

      {err && !busy && (
        <Card className="mt-6 border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">{err}</p>
        </Card>
      )}

      {trace && !busy && (
        <Card className="mt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              {trace.photo ? (
                <img src={trace.photo} alt="" className="h-20 w-20 rounded-lg border border-border object-cover" />
              ) : (
                <span className="flex h-20 w-20 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <ImageIcon size={22} />
                </span>
              )}
              <div>
                <p className="font-serif text-xl font-semibold text-foreground">{trace.productName}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">SKU {trace.variantSku}</Badge>
                  <Badge tone="accent">{trace.barcode}</Badge>
                </div>
              </div>
            </div>
            <div className="rounded-lg bg-muted/50 px-4 py-2.5 text-right">
              <p className="text-[11px] font-semibold uppercase tracking-luxe text-muted-foreground">Saldo (razão)</p>
              <p className={cnSaldo(trace.saldoRazao)}>{trace.saldoRazao}</p>
            </div>
          </div>

          <div className="mt-6 border-t border-border pt-5">
            <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-luxe text-muted-foreground">
              <History size={14} /> Movimentações
            </p>
            {trace.movimentos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem movimentações registradas.</p>
            ) : (
              <ul className="divide-y divide-border">
                {trace.movimentos.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <span className="flex items-center gap-2.5">
                      <span className={`tabular-nums font-semibold ${IS_IN(m.type) ? "text-emerald-600" : "text-red-600"}`}>
                        {IS_IN(m.type) ? "+" : "−"}{m.quantity}
                      </span>
                      <Badge tone={TYPE_TONE[m.type] ?? "neutral"}>{TYPE_LABEL[m.type] ?? m.type}</Badge>
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
        </Card>
      )}

      {/* ── Painéis operacionais ───────────────────────────────────────────── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Entrada / ajuste */}
        <Card>
          <CardHeader
            icon={PackagePlus}
            title="Entrada & ajuste de estoque"
            subtitle="Recebimento de fornecedor, balanço ou quebra/perda."
          />
          <div className="mt-5 space-y-3">
            <select
              value={entryType}
              onChange={(e) => setEntryType(e.target.value as any)}
              className={inputClass}
            >
              <option value="receive">Recebimento (fornecedor)</option>
              <option value="adjust_in">Ajuste + (balanço)</option>
              <option value="adjust_out">Ajuste − (quebra/perda)</option>
            </select>
            <div className="flex gap-2">
              <label className="flex-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Código (bipe ou digite)
                <input
                  value={entryBarcode}
                  onChange={(e) => setEntryBarcode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && lancarEntrada()}
                  placeholder="Bipe ou digite o código…"
                  className={`${inputClass} mt-1 w-full font-normal normal-case tracking-normal`}
                />
              </label>
              <label className="w-20 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Qtd
                <input
                  type="number" min={1} value={entryQty} onChange={(e) => setEntryQty(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && lancarEntrada()}
                  className={`${inputClass} mt-1 w-full text-center font-normal`}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={lancarEntrada} Icon={PackagePlus}>Lançar</Button>
              <span className="text-xs text-muted-foreground">{entryMsg ?? "Bipe a etiqueta ou digite o código e a quantidade."}</span>
            </div>
          </div>
        </Card>

        {/* Etiquetas */}
        <Card>
          <CardHeader
            icon={Tag}
            title="Arquivo de etiquetas"
            subtitle="Exporte os códigos do catálogo para o fornecedor de etiquetas."
          />
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" Icon={Tag} onClick={() => baixarEtiquetas("csv")}>
              Baixar CSV
            </Button>
            <Button variant="outline" size="sm" Icon={Tag} onClick={() => baixarEtiquetas("zpl")}>
              Baixar ZPL (Zebra)
            </Button>
          </div>
          {labelMsg && <p className="mt-3 text-xs text-muted-foreground">{labelMsg}</p>}
        </Card>
      </div>

      {/* ── Busca por foto ─────────────────────────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader
          icon={ImageIcon}
          title="Encontrar código pela foto da peça"
          subtitle="Anexe uma foto do dispositivo (câmera/galeria) ou cole a URL — a visão identifica candidatos do catálogo."
        />
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <input
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && buscarPorFoto()}
            placeholder="URL da foto da peça…"
            className={`${inputClass} flex-1`}
          />
          <label className={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-muted ${photoBusy ? "pointer-events-none opacity-50" : ""}`}>
            <ImageIcon size={15} /> Anexar foto
            <input type="file" accept="image/*" capture="environment" onChange={onPhotoFile} className="hidden" />
          </label>
          <Button onClick={() => buscarPorFoto()} disabled={photoBusy} Icon={Search} className="shrink-0">
            {photoBusy ? "Analisando…" : "Buscar"}
          </Button>
        </div>
        {photoErr && <p className="mt-3 text-sm text-red-600">{photoErr}</p>}
        {photoRes && (
          photoRes.candidatos.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                icon={ImageIcon}
                title="Nenhum candidato"
                description="A visão não encontrou peças do catálogo compatíveis com essa foto."
              />
            </div>
          ) : (
            <ul className="mt-5 space-y-2">
              {photoRes.candidatos.map((c) => (
                <li key={c.productId} className="flex items-start gap-3 rounded-lg border border-border bg-background p-3.5">
                  {c.mainPhoto && <img src={c.mainPhoto} alt="" className="h-14 w-14 rounded-md border border-border object-cover" />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{c.name}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {c.variantes.map((v) => (
                        <span key={v.sku}>{[v.color, v.size].filter(Boolean).join("/") || v.sku}: <b className="text-foreground">{v.barcode ?? "—"}</b></span>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )
        )}
      </Card>
    </Page>
  );
}

function PatternLabelGen() {
  const [pattern, setPattern] = useState<CodePattern>(DEFAULT_CLOTHING_PATTERN);
  const [variants, setVariants] = useState<{ sku: string; size?: string; name: string }[]>([]);
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState(1);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [codes, setCodes] = useState<GeneratedCode[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.getConfig().then((c) => { if (c.codePattern?.segments?.length) setPattern(c.codePattern); }).catch(() => {});
    api.listCatalogProducts().then((ps) => {
      const vs = ps.flatMap((p: any) => (p.variants ?? []).map((v: any) => ({ sku: v.sku, size: v.size, name: p.name })));
      setVariants(vs); if (vs[0]) setSku(vs[0].sku);
    }).catch(() => {});
  }, []);

  // Segmentos que o operador digita (fornecedor, tipo, margem, livre).
  const manualSegs = pattern.segments.filter((s) => ["supplier", "productType", "margin", "custom"].includes(s.kind));

  async function preview() {
    setBusy(true); setErr(""); setCodes(null);
    try { setCodes(await api.generateCodes({ variantSku: sku, quantity: qty, manual })); }
    catch (e: any) { setErr(e?.message ?? "falha"); } finally { setBusy(false); }
  }
  async function download(format: "zpl" | "csv") {
    setErr("");
    try { await downloadPatternLabels({ variantSku: sku, quantity: qty, manual }, format); }
    catch (e: any) { setErr(e?.message ?? "falha"); }
  }

  return (
    <Card className="mt-6">
      <CardHeader icon={Tag} title="Etiquetas com seu padrão" subtitle="Gera o código próprio (Code128 + QR) para cada peça — número sequencial automático. Configure o formato em Configurações." />
      <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
        {err && <div className="md:col-span-2 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>}
        <label className="text-xs font-medium text-muted-foreground">Produto / variante
          <select className={inputClass} value={sku} onChange={(e) => setSku(e.target.value)}>
            {variants.map((v) => <option key={v.sku} value={v.sku}>{v.name} · {v.size ?? ""} ({v.sku})</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">Quantidade de peças
          <input type="number" min={1} max={500} className={inputClass} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
        </label>
        {manualSegs.map((s) => (
          <label key={s.key} className="text-xs font-medium text-muted-foreground">{s.label}
            <input className={inputClass} value={manual[s.key] ?? ""} onChange={(e) => setManual((m) => ({ ...m, [s.key]: e.target.value }))} placeholder={`${s.length || ""} díg.`} />
          </label>
        ))}
        <div className="md:col-span-2 flex flex-wrap gap-2">
          <Button onClick={preview} disabled={busy || !sku}>{busy ? "Gerando…" : "Pré-visualizar"}</Button>
          <Button variant="outline" onClick={() => download("zpl")} disabled={!sku}>Baixar ZPL (impressora)</Button>
          <Button variant="ghost" onClick={() => download("csv")} disabled={!sku}>Baixar CSV</Button>
        </div>
        {codes && codes.length > 0 && (
          <div className="md:col-span-2 rounded-lg bg-muted/40 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{codes.length} código(s) — cada peça um número único</p>
            <div className="mt-1 space-y-0.5 font-mono text-sm text-foreground">
              {codes.slice(0, 10).map((c) => <div key={c.code}>{c.code}</div>)}
              {codes.length > 10 && <div className="text-muted-foreground">… +{codes.length - 10}</div>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {codes[0]!.decoded.map((d) => <span key={d.key}><b className="text-foreground">{d.value}</b> = {d.label}</span>)}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function PiecesStock() {
  const [sum, setSum] = useState<PiecesSummary | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() { api.piecesSummary().then(setSum).catch(() => setSum(null)); }
  useEffect(load, []);

  async function sell() {
    const c = code.trim();
    if (!c) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.sellPiece(c);
      setMsg(r.alreadySold ? `Peça ${r.piece.size} já estava vendida.` : `Baixa OK — ${r.piece.size} (${r.piece.variantSku}) vendida.`);
      setCode(""); load();
    } catch (e: any) { setMsg(e?.message ?? "peça não encontrada"); }
    finally { setBusy(false); }
  }

  if (!sum || (sum.emEstoque === 0 && sum.vendidas === 0)) return null;
  const max = Math.max(1, ...sum.bySize.map((s) => s.count));
  return (
    <Card className="mt-6">
      <CardHeader icon={Barcode} title="Estoque por tamanho (peças)" subtitle={`${sum.emEstoque} peça(s) em estoque · ${sum.vendidas} vendida(s). Cada peça impressa pelo seu padrão é contada aqui.`} />
      <div className="space-y-2 px-5 pb-3">
        {sum.bySize.map((s) => (
          <div key={s.size} className="flex items-center gap-3 text-sm">
            <span className="w-12 shrink-0 font-medium text-foreground">{s.size}</span>
            <div className="h-5 flex-1 overflow-hidden rounded bg-muted">
              <div className="flex h-full items-center rounded bg-primary px-2 text-xs font-medium text-primary-foreground" style={{ width: `${Math.round((s.count / max) * 100)}%` }}>{s.count}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-5 py-4">
        <ScanLine className="h-4 w-4 text-muted-foreground" />
        <input className={`${inputClass} max-w-xs`} placeholder="Escaneie/digite o código da peça para vender"
          value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sell()} />
        <Button onClick={sell} disabled={busy || !code.trim()}>Dar baixa (venda)</Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
    </Card>
  );
}

function cnSaldo(v: number) {
  return `font-serif text-3xl font-semibold ${v < 0 ? "text-red-600" : "text-foreground"}`;
}
