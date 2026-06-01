import { useEffect, useState } from "react";
import { Store, Shirt, Cake, PawPrint, Pill, Package, ChevronDown, ChevronUp, Boxes, Plus, Pencil, Trash2, RefreshCw, X, type LucideIcon } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { formatBRL } from "../lib/utils";
import { api, type WholesaleProductRow, type CatalogProduct, type ProductVariant } from "../lib/api";
import { Page, Card, Button, Badge, EmptyState, Skeleton, inputClass } from "../components/ui";

type Product = CatalogProduct;

type MarginInfo = { brl: number; pct: number; tone: "success" | "neutral" | "warning" };

// Exemplos/ícone do catálogo conforme o segmento da loja (ADR-029).
type SegMeta = { Icon: LucideIcon; namePh: string; colorPh: string; sizePh: string; emptyDesc: string };
const SEGMENT_META: Record<string, SegMeta> = {
  moda:     { Icon: Shirt,    namePh: "Vestido Floral Manga 3/4", colorPh: "cor",     sizePh: "tam",     emptyDesc: "Cadastre suas peças ou conecte seu ERP para vê-las aqui." },
  bolos:    { Icon: Cake,     namePh: "Bolo de Chocolate 1kg",    colorPh: "sabor",   sizePh: "tamanho", emptyDesc: "Cadastre seus bolos e doces ou conecte seu ERP para vê-los aqui." },
  farmacia: { Icon: Pill,     namePh: "Dipirona 500mg 10cp",      colorPh: "marca",   sizePh: "dosagem", emptyDesc: "Cadastre seus itens ou conecte seu ERP para vê-los aqui." },
  pet:      { Icon: PawPrint, namePh: "Ração Premium Adulto 10kg", colorPh: "sabor",   sizePh: "peso",    emptyDesc: "Cadastre seus produtos ou conecte seu ERP para vê-los aqui." },
  generico: { Icon: Package,  namePh: "Nome do produto",          colorPh: "variação", sizePh: "opção",  emptyDesc: "Cadastre seus produtos ou conecte seu ERP para vê-los aqui." },
};
const segMeta = (segment?: string): SegMeta => SEGMENT_META[(segment ?? "").toLowerCase()] ?? SEGMENT_META.generico;

function marginInfo(price: number, cost?: number): MarginInfo | null {
  if (cost == null) return null;
  const brl = price - cost;
  const pct = price > 0 ? (brl / price) * 100 : 0;
  // faixas: <40% baixa (âmbar), 40–60% ok, >60% alta (verde)
  const tone: MarginInfo["tone"] = pct >= 60 ? "success" : pct >= 40 ? "neutral" : "warning";
  return { brl, pct, tone };
}

export function Catalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [segment, setSegment] = useState<string>(""); // segmento do tenant (ADR-029)
  const isFashion = segment.toLowerCase() === "moda";
  const meta = segMeta(segment);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.listCatalogProducts()
      .then(setProducts)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    api.getConfig().then((c) => setSegment(c.segment ?? "")).catch(() => {});
  }, []);

  async function remove(p: Product) {
    if (!window.confirm(`Remover "${p.name}" do catálogo?`)) return;
    setNotice(null);
    try { await api.deleteProduct(p.id); load(); }
    catch (e: any) { setError(String(e?.message ?? e)); }
  }

  async function syncTray() {
    setSyncing(true); setNotice(null); setError(null);
    try { const r = await api.syncCatalog(); setNotice(`Sincronizado do ERP: ${r.upserted} produto(s).`); load(); }
    catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setSyncing(false); }
  }

  return (
    <Page>
      <PageHeader eyebrow="CATÁLOGO" title="A coleção" />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={() => { setEditing("new"); setNotice(null); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-soft transition-opacity hover:opacity-90">
          <Plus size={15} /> Novo produto
        </button>
        <button onClick={syncTray} disabled={syncing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50">
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} /> {syncing ? "Sincronizando…" : "Sincronizar Tray"}
        </button>
        {notice && <span className="text-xs text-emerald-700">{notice}</span>}
      </div>

      {editing && (
        <ProductForm
          initial={editing === "new" ? null : editing}
          meta={meta}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      <WholesalePanel />

      {error && (
        <p className="mt-6 text-sm text-red-600">Erro: {error}</p>
      )}

      {loading && (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} padded={false} className="overflow-hidden">
              <Skeleton className="aspect-[3/4] rounded-none" />
              <div className="space-y-3 p-5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-24" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {!loading && !error && products.length === 0 && (
        <div className="mt-8">
          <EmptyState
            icon={meta.Icon}
            title="Catálogo vazio"
            description={meta.emptyDesc}
          />
        </div>
      )}

      {!loading && products.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => {
            const totalStock = p.variants.reduce((s, v) => s + v.stock, 0);
            const m = marginInfo(p.priceBRL, p.costBRL ?? undefined);
            const hasMeasurements = isFashion && p.measurements && Object.keys(p.measurements).length > 0;
            return (
              <Card key={p.externalId} hover padded={false} className="group flex flex-col overflow-hidden">
                {/* Foto — herói visual */}
                <div className="relative aspect-[3/4] overflow-hidden rounded-t-xl bg-gradient-to-br from-muted to-accent-soft">
                  <div className="flex h-full w-full items-center justify-center text-primary/30 transition-transform duration-500 group-hover:scale-105">
                    <meta.Icon size={56} strokeWidth={1} />
                  </div>
                  <div className="absolute left-3 top-3">
                    {m ? (
                      <Badge
                        tone={m.tone}
                        className="shadow-soft"
                        // título preservado: contexto de custo/margem
                      >
                        <span title={`Custo ${formatBRL(p.costBRL!)} · margem ${formatBRL(m.brl)}`}>
                          margem {m.pct.toFixed(0)}%
                        </span>
                      </Badge>
                    ) : (
                      <Badge tone="warning" className="shadow-soft">
                        <span title="Cadastre o custo pra calcular a margem">sem custo</span>
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Conteúdo */}
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      {p.source === "manual" ? p.externalId.slice(0, 12) : p.externalId}
                    </p>
                    <Badge tone={p.source === "manual" ? "accent" : "neutral"} className="text-[9px]">
                      {p.source === "manual" ? "manual" : "Tray"}
                    </Badge>
                  </div>
                  <h3 className="mt-1.5 font-serif text-lg font-semibold leading-snug text-foreground">
                    {p.name}
                  </h3>

                  <div className="mt-3 flex items-baseline gap-2">
                    <p className="font-serif text-xl font-semibold text-foreground">{formatBRL(p.priceBRL)}</p>
                  </div>

                  <p className="mt-3 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{p.variants.length}</span> variante(s)
                    <span className="mx-1.5 text-border">·</span>
                    <span className="font-medium text-foreground">{totalStock}</span> em estoque
                  </p>

                  {hasMeasurements && (
                    <div className="mt-4 border-t border-border pt-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Medidas por tamanho (cm)
                      </p>
                      <div className="overflow-x-auto">
                        <table className="mt-2 w-full text-[11px]">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="pb-1 text-left font-normal">Tam</th>
                            <th className="pb-1 text-right font-normal">Busto</th>
                            <th className="pb-1 text-right font-normal">Cintura</th>
                            <th className="pb-1 text-right font-normal">Quadril</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {Object.entries(p.measurements!).map(([size, mm]) => (
                            <tr key={size}>
                              <td className="py-1 font-medium text-foreground">{size}</td>
                              <td className="py-1 text-right text-muted-foreground">{mm.bust ?? "—"}</td>
                              <td className="py-1 text-right text-muted-foreground">{mm.waist ?? "—"}</td>
                              <td className="py-1 text-right text-muted-foreground">{mm.hips ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Ações */}
                  <div className="mt-auto flex items-center gap-2 pt-4">
                    {p.source === "manual" ? (
                      <button onClick={() => { setEditing(p); setNotice(null); }}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted">
                        <Pencil size={12} /> Editar
                      </button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground" title="Produto sincronizado do ERP — edite na Tray">via Tray (edite no ERP)</span>
                    )}
                    <button onClick={() => remove(p)}
                      className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50">
                      <Trash2 size={12} /> Remover
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}

/** Formulário de criar/editar produto manual. */
function ProductForm({ initial, meta, onSaved, onCancel }: { initial: Product | null; meta: SegMeta; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [price, setPrice] = useState(initial?.priceBRL != null ? String(initial.priceBRL) : "");
  const [cost, setCost] = useState(initial?.costBRL != null ? String(initial.costBRL) : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [variants, setVariants] = useState<ProductVariant[]>(
    initial?.variants?.length ? initial.variants : [{ sku: "", color: "", size: "", stock: 0 }],
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function setVariant(i: number, patch: Partial<ProductVariant>) {
    setVariants((vs) => vs.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  }
  const addVariant = () => setVariants((vs) => [...vs, { sku: "", color: "", size: "", stock: 0 }]);
  const removeVariant = (i: number) => setVariants((vs) => (vs.length > 1 ? vs.filter((_, idx) => idx !== i) : vs));

  async function submit() {
    setErr(null);
    const priceNum = Number(price);
    if (!name.trim()) return setErr("Informe o nome.");
    if (!(priceNum > 0)) return setErr("Informe um preço maior que zero.");
    const cleanVariants = variants
      .map((v) => ({ sku: v.sku.trim(), color: v.color?.trim() || undefined, size: v.size?.trim() || undefined, stock: Number(v.stock) || 0 }))
      .filter((v) => v.sku);
    if (cleanVariants.length === 0) return setErr("Informe ao menos uma variante com SKU.");
    const input = {
      name: name.trim(),
      description: description.trim() || undefined,
      priceBRL: priceNum,
      costBRL: cost.trim() ? Number(cost) : null,
      variants: cleanVariants,
    };
    setBusy(true);
    try {
      if (initial) await api.updateProduct(initial.id, input);
      else await api.createProduct(input);
      onSaved();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <Card className="mt-6">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-semibold">{initial ? "Editar produto" : "Novo produto"}</h3>
        <button onClick={onCancel} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X size={18} /></button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2 text-sm font-medium">Nome
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} mt-1`} placeholder={meta.namePh} />
        </label>
        <label className="text-sm font-medium">Preço (R$)
          <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={`${inputClass} mt-1`} placeholder="289.00" />
        </label>
        <label className="text-sm font-medium">Custo (R$) <span className="font-normal text-muted-foreground">— opcional, p/ margem</span>
          <input type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} className={`${inputClass} mt-1`} placeholder="100.00" />
        </label>
        <label className="sm:col-span-2 text-sm font-medium">Descrição <span className="font-normal text-muted-foreground">— opcional</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Variantes (SKU, {meta.colorPh}, {meta.sizePh}, estoque)</p>
          <button onClick={addVariant} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><Plus size={13} /> adicionar</button>
        </div>
        <div className="mt-2 space-y-2">
          {variants.map((v, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input value={v.sku} onChange={(e) => setVariant(i, { sku: e.target.value })} className={`${inputClass} w-40 px-2.5 py-1.5`} placeholder="SKU *" />
              <input value={v.color ?? ""} onChange={(e) => setVariant(i, { color: e.target.value })} className={`${inputClass} w-28 px-2.5 py-1.5`} placeholder={meta.colorPh} />
              <input value={v.size ?? ""} onChange={(e) => setVariant(i, { size: e.target.value })} className={`${inputClass} w-24 px-2.5 py-1.5`} placeholder={meta.sizePh} />
              <input type="number" min={0} value={v.stock} onChange={(e) => setVariant(i, { stock: Number(e.target.value) })} className={`${inputClass} w-24 px-2.5 py-1.5`} placeholder="estoque" />
              <button onClick={() => removeVariant(i)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" title="remover variante"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}

      <div className="mt-5 flex items-center gap-2">
        <button onClick={submit} disabled={busy}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? "Salvando…" : initial ? "Salvar alterações" : "Criar produto"}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Cancelar</button>
      </div>
    </Card>
  );
}

/** Opt-in de atacado B2B (ADR-024): expõe produtos na rede com preço/qtd mínima. */
function WholesalePanel() {
  const [rows, setRows] = useState<WholesaleProductRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() { api.listWholesale().then(setRows).catch((e) => setErr(String(e))); }
  useEffect(() => { if (open && rows.length === 0) load(); }, [open]);

  async function save(r: WholesaleProductRow, patch: { enabled?: boolean; priceBRL?: number | null; minQty?: number }) {
    setBusy(r.id); setErr(null);
    const enabled = patch.enabled ?? r.wholesaleEnabled;
    try {
      await api.setWholesale(r.id, {
        enabled,
        priceBRL: patch.priceBRL !== undefined ? patch.priceBRL : r.wholesalePriceBRL,
        minQty: patch.minQty !== undefined ? patch.minQty : r.wholesaleMinQty,
      });
      load();
    } catch (e: any) {
      setErr(/400/.test(String(e)) ? "Informe o preço de atacado para expor." : String(e?.message ?? e));
    } finally { setBusy(null); }
  }

  const exposed = rows.filter((r) => r.wholesaleEnabled).length;

  return (
    <Card padded={false} className="mt-6 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-6 py-5 text-left transition-colors hover:bg-muted/40"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-primary">
          <Store size={17} />
        </span>
        <span className="font-serif text-lg font-semibold text-foreground">Rede de atacado (B2B)</span>
        <Badge tone="accent">{exposed} exposto(s)</Badge>
        <span className="ml-auto text-muted-foreground">
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-6 py-5">
          <p className="mb-4 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Produtos marcados aqui ficam visíveis na rede de atacado (MCP) para outras lojas comprarem em grosso.
          </p>
          {err && <p className="mb-4 text-sm text-red-600">{err}</p>}
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-3.5">
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={r.wholesaleEnabled}
                    disabled={busy === r.id}
                    onChange={(e) => save(r, { enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-border text-primary accent-primary focus:ring-2 focus:ring-accent-soft"
                  />
                  <span className="font-medium text-foreground">{r.name}</span>
                </label>
                <span className="text-xs text-muted-foreground">
                  varejo <span className="font-medium text-foreground">{formatBRL(r.priceBRL)}</span>
                  <span className="mx-1.5 text-border">·</span>
                  estoque <span className="font-medium text-foreground">{r.stock}</span>
                </span>
                <div className="ml-auto flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    atacado R$
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      defaultValue={r.wholesalePriceBRL ?? ""}
                      onBlur={(e) => { const v = Number(e.target.value); if (e.target.value && v !== r.wholesalePriceBRL) save(r, { priceBRL: v }); }}
                      className={`${inputClass} w-28 px-2.5 py-1.5`}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    mín
                    <input
                      type="number"
                      min={1}
                      defaultValue={r.wholesaleMinQty}
                      onBlur={(e) => { const v = Number(e.target.value); if (v && v !== r.wholesaleMinQty) save(r, { minQty: v }); }}
                      className={`${inputClass} w-20 px-2.5 py-1.5`}
                    />
                  </label>
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="py-6">
                <EmptyState
                  icon={Boxes}
                  title="Nenhum produto interno encontrado"
                  description="Sincronize o catálogo do seu ERP para expor peças na rede de atacado."
                />
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
