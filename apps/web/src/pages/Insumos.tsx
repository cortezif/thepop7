import { useEffect, useMemo, useState } from "react";
import { Boxes, Plus, Trash2, AlertTriangle, PackageOpen, Wheat, ShoppingCart } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Page, Card, CardHeader, Button, Badge, EmptyState, Skeleton, Tabs, inputClass } from "../components/ui";
import { api, type RawMaterial, type RawMaterialInput, type InsumoReorder } from "../lib/api";

type Cat = "ingrediente" | "embalagem";
const UNITS = ["g", "kg", "ml", "L", "un"];

export function Insumos() {
  const [cat, setCat] = useState<Cat>("ingrediente");
  const [items, setItems] = useState<RawMaterial[] | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setItems(null);
    setItems(await api.listMaterials().catch(() => []));
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => (items ?? []).filter((m) => m.category === cat), [items, cat]);
  const counts = useMemo(() => ({
    ingrediente: (items ?? []).filter((m) => m.category === "ingrediente").length,
    embalagem: (items ?? []).filter((m) => m.category === "embalagem").length,
  }), [items]);

  return (
    <Page>
      <PageHeader
        eyebrow="FABRICAÇÃO"
        title="Insumos & embalagens"
        subtitle="O estoque que entra na fabricação: ingredientes (consumidos ao produzir) e materiais de embalagem (consumidos ao vender). O custo por unidade-base alimenta a ficha técnica."
      />

      <Reposicao />

      <div className="mb-6 flex items-center justify-between gap-4">
        <Tabs
          active={cat}
          onChange={(k) => { setCat(k); setShowForm(false); }}
          tabs={[
            { key: "ingrediente", label: "Ingredientes", count: counts.ingrediente },
            { key: "embalagem", label: "Embalagens", count: counts.embalagem },
          ]}
        />
        <Button Icon={Plus} onClick={() => setShowForm((s) => !s)}>Novo insumo</Button>
      </div>

      {showForm && <MaterialForm defaultCategory={cat} onSaved={() => { setShowForm(false); load(); }} />}

      {items === null ? (
        <Skeleton className="h-40 w-full" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={cat === "ingrediente" ? Wheat : PackageOpen}
          title={cat === "ingrediente" ? "Nenhum ingrediente cadastrado" : "Nenhuma embalagem cadastrada"}
          description="Cadastre os insumos com a unidade de consumo (g, ml, un) e o custo — eles compõem as receitas."
          action={<Button Icon={Plus} onClick={() => setShowForm(true)}>Cadastrar</Button>}
        />
      ) : (
        <Card padded={false}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">Unidade</th>
                <th className="px-5 py-3 text-right font-medium">Custo / unid.</th>
                <th className="px-5 py-3 text-right font-medium">Estoque</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <MaterialRow key={m.id} m={m} onChanged={load} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}

// ── Reposição (insumos no/abaixo do mínimo → pesquisa de preço) ───────────────
function Reposicao() {
  const [items, setItems] = useState<InsumoReorder[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { api.materialsReorder().then(setItems).catch(() => setItems([])); }, []);
  if (!items || items.length === 0) return null;

  async function criarPesquisa() {
    setBusy(true); setMsg(null);
    try {
      await api.mercCreateResearch({
        title: "Reposição de insumos",
        items: items!.map((i) => ({ description: i.name, quantity: Math.ceil(i.suggestedQty) })),
      });
      setMsg("Pesquisa de preço criada na Mercadológica ✓ — vá em Mercadológica para enviar aos fornecedores.");
    } catch { setMsg("Não foi possível criar a pesquisa de preço."); }
    finally { setBusy(false); }
  }

  return (
    <Card className="mb-6 border-amber-200 bg-amber-50/40">
      <CardHeader
        icon={AlertTriangle}
        title={`Reposição sugerida (${items.length})`}
        subtitle="Insumos no/abaixo do estoque mínimo. Sugestão de compra para repor até 2× o mínimo."
        action={<Button size="sm" Icon={ShoppingCart} onClick={criarPesquisa} disabled={busy}>{busy ? "Criando…" : "Criar pesquisa de preço"}</Button>}
      />
      <div className="mt-4 space-y-1.5">
        {items.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
            <span className="font-medium text-foreground">{i.name}</span>
            <span className="text-muted-foreground">
              tem {i.stockQty} {i.baseUnit} / mín {i.minStockQty} {i.baseUnit} · comprar ~<b className="text-foreground">{i.suggestedQty} {i.baseUnit}</b>
              {i.purchaseUnits ? ` (≈ ${i.purchaseUnits}× ${i.purchaseUnit})` : ""}
            </span>
          </div>
        ))}
      </div>
      {msg && <p className="mt-3 text-sm text-emerald-700">{msg}</p>}
    </Card>
  );
}

function MaterialRow({ m, onChanged }: { m: RawMaterial; onChanged: () => void }) {
  const [cost, setCost] = useState(String(m.costPerBaseUnit));
  const [stock, setStock] = useState(String(m.stockQty));
  const [busy, setBusy] = useState(false);
  const dirty = Number(cost) !== m.costPerBaseUnit || Number(stock) !== m.stockQty;

  async function save() {
    setBusy(true);
    try {
      await api.updateMaterial(m.id, { costPerBaseUnit: Number(cost), stockQty: Number(stock) });
      onChanged();
    } finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm(`Remover "${m.name}"?`)) return;
    setBusy(true);
    try { await api.deleteMaterial(m.id); onChanged(); } finally { setBusy(false); }
  }

  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="px-5 py-3">
        <span className="font-medium text-foreground">{m.name}</span>
        {m.sku && <span className="ml-2 text-xs text-muted-foreground">{m.sku}</span>}
        {m.lowStock && (
          <Badge tone="warning" className="ml-2"><AlertTriangle size={11} /> baixo</Badge>
        )}
      </td>
      <td className="px-5 py-3 text-muted-foreground">{m.baseUnit}</td>
      <td className="px-5 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <span className="text-xs text-muted-foreground">R$</span>
          <input className={`${inputClass} w-24 text-right`} value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" />
          <span className="text-xs text-muted-foreground">/{m.baseUnit}</span>
        </div>
      </td>
      <td className="px-5 py-3 text-right">
        <input className={`${inputClass} w-24 text-right`} value={stock} onChange={(e) => setStock(e.target.value)} inputMode="decimal" />
      </td>
      <td className="px-5 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {dirty && <Button size="sm" onClick={save} disabled={busy}>Salvar</Button>}
          <Button size="sm" variant="ghost" Icon={Trash2} onClick={remove} disabled={busy} aria-label="Remover" />
        </div>
      </td>
    </tr>
  );
}

function MaterialForm({ defaultCategory, onSaved }: { defaultCategory: Cat; onSaved: () => void }) {
  const [f, setF] = useState<RawMaterialInput>({
    name: "", category: defaultCategory, baseUnit: defaultCategory === "embalagem" ? "un" : "g",
    costPerBaseUnit: 0, stockQty: 0,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<RawMaterialInput>) => setF((s) => ({ ...s, ...p }));

  async function submit() {
    if (!f.name.trim()) { setErr("Informe o nome."); return; }
    setBusy(true); setErr(null);
    try {
      await api.createMaterial({
        ...f,
        costPerBaseUnit: Number(f.costPerBaseUnit) || 0,
        stockQty: Number(f.stockQty) || 0,
        minStockQty: f.minStockQty != null && String(f.minStockQty) !== "" ? Number(f.minStockQty) : null,
        purchaseQtyInBase: f.purchaseQtyInBase != null && String(f.purchaseQtyInBase) !== "" ? Number(f.purchaseQtyInBase) : null,
      });
      onSaved();
    } catch (e: any) { setErr(e?.message ?? "Erro ao salvar"); } finally { setBusy(false); }
  }

  return (
    <Card className="mb-6">
      <CardHeader icon={Boxes} title="Novo insumo" subtitle="A unidade-base é a unidade de consumo (a receita lança quantidades nela)." />
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Nome">
          <input className={inputClass} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Farinha de trigo" />
        </Field>
        <Field label="Categoria">
          <select className={inputClass} value={f.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="ingrediente">Ingrediente</option>
            <option value="embalagem">Embalagem</option>
          </select>
        </Field>
        <Field label="Unidade-base">
          <select className={inputClass} value={f.baseUnit} onChange={(e) => set({ baseUnit: e.target.value })}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
        <Field label={`Custo por ${f.baseUnit ?? "unidade"} (R$)`}>
          <input className={inputClass} value={f.costPerBaseUnit ?? 0} onChange={(e) => set({ costPerBaseUnit: e.target.value as any })} inputMode="decimal" />
        </Field>
        <Field label={`Estoque atual (${f.baseUnit ?? ""})`}>
          <input className={inputClass} value={f.stockQty ?? 0} onChange={(e) => set({ stockQty: e.target.value as any })} inputMode="decimal" />
        </Field>
        <Field label={`Alerta de estoque mín. (${f.baseUnit ?? ""})`} hint="opcional">
          <input className={inputClass} value={f.minStockQty ?? ""} onChange={(e) => set({ minStockQty: e.target.value as any })} inputMode="decimal" />
        </Field>
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex gap-2">
        <Button onClick={submit} disabled={busy}>{busy ? "Salvando…" : "Salvar insumo"}</Button>
      </div>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}{hint && <span className="ml-1 text-muted-foreground/60">({hint})</span>}
      </span>
      {children}
    </label>
  );
}
