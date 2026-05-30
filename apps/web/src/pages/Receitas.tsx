import { useEffect, useMemo, useState } from "react";
import { ScrollText, Plus, Trash2, X, Calculator, Link2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Page, Card, CardHeader, Button, EmptyState, Skeleton, inputClass } from "../components/ui";
import { api, type Bom, type BomInput, type RawMaterial, type CatalogProduct } from "../lib/api";
import { formatBRL } from "../lib/utils";

type Draft = {
  id?: string;
  name: string;
  productId: string;
  yieldQty: string;
  lossPct: string;
  notes: string;
  items: Array<{ materialId: string; quantity: string }>;
};

const emptyDraft = (): Draft => ({ name: "", productId: "", yieldQty: "1", lossPct: "0", notes: "", items: [] });

export function Receitas() {
  const [boms, setBoms] = useState<Bom[] | null>(null);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  async function load() {
    setBoms(null);
    const [b, m, p] = await Promise.all([
      api.listBoms().catch(() => []),
      api.listMaterials().catch(() => []),
      api.listCatalogProducts().catch(() => []),
    ]);
    setBoms(b); setMaterials(m); setProducts(p);
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader
        eyebrow="FABRICAÇÃO"
        title="Fichas técnicas"
        subtitle="A receita de cada produto: quanto de cada insumo entra. A partir dela o custo do produto é calculado sozinho — e atualiza quando o preço do insumo muda."
      />

      <div className="mb-6 flex justify-end">
        <Button Icon={Plus} onClick={() => setDraft(emptyDraft())}>Nova ficha técnica</Button>
      </div>

      {draft && (
        <BomEditor
          draft={draft}
          materials={materials}
          products={products}
          onClose={() => setDraft(null)}
          onSaved={() => { setDraft(null); load(); }}
        />
      )}

      {boms === null ? (
        <Skeleton className="h-40 w-full" />
      ) : boms.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="Nenhuma ficha técnica"
          description="Cadastre os insumos primeiro e monte a receita de cada produto fabricado."
          action={<Button Icon={Plus} onClick={() => setDraft(emptyDraft())}>Criar ficha</Button>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {boms.map((b) => (
            <BomCard key={b.id} bom={b} products={products} onEdit={() => setDraft(toDraft(b))} onChanged={load} />
          ))}
        </div>
      )}
    </Page>
  );
}

function toDraft(b: Bom): Draft {
  return {
    id: b.id, name: b.name, productId: b.productId ?? "",
    yieldQty: String(b.yieldQty), lossPct: String(b.lossPct), notes: b.notes ?? "",
    items: b.items.map((i) => ({ materialId: i.materialId, quantity: String(i.quantity) })),
  };
}

function BomCard({ bom, products, onEdit, onChanged }: { bom: Bom; products: CatalogProduct[]; onEdit: () => void; onChanged: () => void }) {
  const product = products.find((p) => p.id === bom.productId);
  async function remove() {
    if (!confirm(`Remover a ficha "${bom.name}"?`)) return;
    await api.deleteBom(bom.id); onChanged();
  }
  return (
    <Card>
      <CardHeader
        icon={ScrollText}
        title={bom.name}
        subtitle={product ? `Produto: ${product.name}` : "Sem produto vinculado"}
        action={
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={onEdit}>Editar</Button>
            <Button size="sm" variant="ghost" Icon={Trash2} onClick={remove} aria-label="Remover" />
          </div>
        }
      />
      <div className="mt-4 space-y-1.5">
        {bom.items.map((i) => (
          <div key={i.materialId} className="flex items-center justify-between text-sm">
            <span className="text-foreground">{i.materialName}</span>
            <span className="text-muted-foreground">{i.quantity} {i.baseUnit} · {formatBRL(i.lineCost)}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <div className="text-xs text-muted-foreground">
          Rende {bom.yieldQty}{bom.yieldUnit ? ` ${bom.yieldUnit}` : ""}{bom.lossPct ? ` · perda ${bom.lossPct}%` : ""}
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Custo por unidade</p>
          <p className="font-serif text-xl font-semibold text-foreground">{formatBRL(bom.unitCost)}</p>
        </div>
      </div>
      {product && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700">
          <Link2 size={12} /> custo aplicado ao produto (margem atualizada)
        </p>
      )}
    </Card>
  );
}

function BomEditor({
  draft, materials, products, onClose, onSaved,
}: { draft: Draft; materials: RawMaterial[]; products: CatalogProduct[]; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<Draft>) => setD((s) => ({ ...s, ...p }));
  const matById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  // Custo ao vivo — mesma fórmula do servidor (Σ qtd×custo × (1+perda%) ÷ rende).
  const preview = useMemo(() => {
    const raw = d.items.reduce((acc, it) => {
      const m = matById.get(it.materialId);
      return acc + (Number(it.quantity) || 0) * (m ? m.costPerBaseUnit : 0);
    }, 0);
    const withLoss = raw * (1 + (Number(d.lossPct) || 0) / 100);
    const y = Number(d.yieldQty) || 1;
    return { total: withLoss, unit: withLoss / (y <= 0 ? 1 : y) };
  }, [d, matById]);

  function addItem() {
    const first = materials[0]?.id ?? "";
    set({ items: [...d.items, { materialId: first, quantity: "" }] });
  }
  function updateItem(idx: number, p: Partial<{ materialId: string; quantity: string }>) {
    set({ items: d.items.map((it, i) => (i === idx ? { ...it, ...p } : it)) });
  }
  function removeItem(idx: number) {
    set({ items: d.items.filter((_, i) => i !== idx) });
  }

  async function submit() {
    if (!d.name.trim()) { setErr("Informe o nome da ficha."); return; }
    const items = d.items.filter((it) => it.materialId && Number(it.quantity) > 0)
      .map((it) => ({ materialId: it.materialId, quantity: Number(it.quantity) }));
    if (items.length === 0) { setErr("Adicione ao menos um insumo com quantidade."); return; }
    const payload: BomInput = {
      name: d.name.trim(),
      productId: d.productId || null,
      yieldQty: Number(d.yieldQty) || 1,
      lossPct: Number(d.lossPct) || 0,
      notes: d.notes || null,
      items,
    };
    setBusy(true); setErr(null);
    try {
      if (d.id) await api.updateBom(d.id, payload);
      else await api.createBom(payload);
      onSaved();
    } catch (e: any) { setErr(e?.message ?? "Erro ao salvar"); } finally { setBusy(false); }
  }

  return (
    <Card className="mb-6">
      <CardHeader
        icon={Calculator}
        title={d.id ? "Editar ficha técnica" : "Nova ficha técnica"}
        subtitle="Monte a composição. O custo é calculado em tempo real."
        action={<Button size="sm" variant="ghost" Icon={X} onClick={onClose} aria-label="Fechar" />}
      />

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome da ficha</span>
          <input className={inputClass} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Bolo de chocolate 2kg" />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Produto vinculado (custo é aplicado nele)</span>
          <select className={inputClass} value={d.productId} onChange={(e) => set({ productId: e.target.value })}>
            <option value="">— sem vínculo —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Rendimento (unidades)</span>
          <input className={inputClass} value={d.yieldQty} onChange={(e) => set({ yieldQty: e.target.value })} inputMode="decimal" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Perda esperada (%)</span>
          <input className={inputClass} value={d.lossPct} onChange={(e) => set({ lossPct: e.target.value })} inputMode="decimal" />
        </label>
      </div>

      {/* Itens */}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Insumos</span>
          <Button size="sm" variant="soft" Icon={Plus} onClick={addItem} disabled={materials.length === 0}>Adicionar insumo</Button>
        </div>
        {materials.length === 0 && (
          <p className="text-sm text-amber-700">Cadastre insumos antes de montar a receita.</p>
        )}
        <div className="space-y-2">
          {d.items.map((it, idx) => {
            const m = matById.get(it.materialId);
            const line = (Number(it.quantity) || 0) * (m ? m.costPerBaseUnit : 0);
            return (
              <div key={idx} className="flex items-center gap-2">
                <select className={`${inputClass} flex-1`} value={it.materialId} onChange={(e) => updateItem(idx, { materialId: e.target.value })}>
                  {materials.map((mm) => <option key={mm.id} value={mm.id}>{mm.name} ({mm.baseUnit})</option>)}
                </select>
                <input className={`${inputClass} w-28`} value={it.quantity} onChange={(e) => updateItem(idx, { quantity: e.target.value })} placeholder="qtd" inputMode="decimal" />
                <span className="w-12 text-xs text-muted-foreground">{m?.baseUnit}</span>
                <span className="w-24 text-right text-sm text-muted-foreground">{formatBRL(line)}</span>
                <Button size="sm" variant="ghost" Icon={Trash2} onClick={() => removeItem(idx)} aria-label="Remover" />
              </div>
            );
          })}
        </div>
      </div>

      {/* Custo ao vivo */}
      <div className="mt-6 flex items-center justify-between rounded-lg bg-accent-soft px-5 py-4">
        <div className="text-sm text-primary-strong">
          <span className="font-medium">Custo da receita:</span> {formatBRL(preview.total)}
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wider text-primary-strong/70">Custo por unidade</p>
          <p className="font-serif text-2xl font-semibold text-primary-strong">{formatBRL(preview.unit)}</p>
        </div>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex gap-2">
        <Button onClick={submit} disabled={busy}>{busy ? "Salvando…" : d.id ? "Salvar alterações" : "Salvar ficha"}</Button>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      </div>
    </Card>
  );
}
