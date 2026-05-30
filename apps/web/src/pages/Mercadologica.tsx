import { useEffect, useState } from "react";
import { Store, Search, ClipboardCheck, Plus, Send, Trophy, AlertTriangle, Copy, CheckCircle2, XCircle, Sparkles } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Page, Card, CardHeader, Button, Badge, EmptyState, Skeleton, Tabs, inputClass } from "../components/ui";
import { api, type MercSupplier, type MercResearch, type MercConsolidation, type MercPendingQuote, type MercPanel } from "../lib/api";
import { formatBRL } from "../lib/utils";

type Tab = "painel" | "fornecedores" | "pesquisas" | "pendentes";

export function Mercadologica() {
  const [tab, setTab] = useState<Tab>("painel");
  const [panel, setPanel] = useState<MercPanel | null>(null);

  useEffect(() => { api.mercPanel().then(setPanel).catch(() => {}); }, [tab]);

  return (
    <Page>
      <PageHeader
        eyebrow="SUPRIMENTOS"
        title="Mercadológica"
        subtitle="Rede de fornecedores e pesquisa de preços. Fornecedores ofertam preços; você compara propostas — inclusive de fornecedores ainda não cadastrados."
      />

      <div className="mb-6">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: "painel", label: "Painel" },
            { key: "fornecedores", label: "Fornecedores", count: panel?.suppliers },
            { key: "pesquisas", label: "Pesquisas de preço" },
            { key: "pendentes", label: "Pendentes", count: panel?.pendingQuotes },
          ]}
        />
      </div>

      {tab === "painel" && <Painel panel={panel} />}
      {tab === "fornecedores" && <Fornecedores />}
      {tab === "pesquisas" && <Pesquisas />}
      {tab === "pendentes" && <Pendentes />}
    </Page>
  );
}

// ── Painel ─────────────────────────────────────────────────────────────────────
function Painel({ panel }: { panel: MercPanel | null }) {
  if (!panel) return <Skeleton className="h-40 w-full" />;
  const stat = (label: string, value: number | string) => (
    <Card className="text-center">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 font-serif text-3xl font-semibold">{value}</p>
    </Card>
  );
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stat("Fornecedores", panel.suppliers)}
        {stat("Cotações pendentes", panel.pendingQuotes)}
        {stat("Pesquisas em coleta", panel.researchesByStatus["em-coleta"] ?? 0)}
        {stat("Convites respondidos", panel.invitesByState["respondido"] ?? 0)}
      </div>
      <Card>
        <CardHeader icon={Send} title="Convites por estado" subtitle="Status dos pedidos de cotação enviados a fornecedores." />
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(panel.invitesByState).length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum convite enviado ainda.</p>
          )}
          {Object.entries(panel.invitesByState).map(([state, count]) => (
            <Badge key={state} tone={state === "respondido" ? "success" : state === "sem-resposta" ? "danger" : "neutral"}>
              {state}: {count}
            </Badge>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Fornecedores ────────────────────────────────────────────────────────────────
function Fornecedores() {
  const [list, setList] = useState<MercSupplier[] | null>(null);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: "", document: "", email: "", phone: "", uf: "", municipio: "" });
  const [busy, setBusy] = useState(false);

  function load() { api.mercSuppliers().then(setList).catch(() => setList([])); }
  useEffect(load, []);

  async function create() {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await api.mercCreateSupplier({
        name: form.name.trim(), document: form.document || undefined, email: form.email || undefined,
        phone: form.phone || undefined, uf: form.uf || undefined, municipio: form.municipio || undefined,
      });
      setForm({ name: "", document: "", email: "", phone: "", uf: "", municipio: "" });
      setShow(false); load();
    } finally { setBusy(false); }
  }

  if (!list) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button Icon={Plus} onClick={() => setShow((s) => !s)}>Novo fornecedor</Button>
      </div>

      {show && (
        <Card>
          <CardHeader icon={Store} title="Cadastrar fornecedor" />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input className={inputClass} placeholder="Nome / Razão social" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={inputClass} placeholder="CNPJ/CPF (opcional)" value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} />
            <input className={inputClass} placeholder="E-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className={inputClass} placeholder="Telefone / WhatsApp" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className={inputClass} placeholder="UF" value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase().slice(0, 2) })} />
            <input className={inputClass} placeholder="Município" value={form.municipio} onChange={(e) => setForm({ ...form, municipio: e.target.value })} />
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={create} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
            <Button variant="ghost" onClick={() => setShow(false)}>Cancelar</Button>
          </div>
        </Card>
      )}

      {list.length === 0 ? (
        <EmptyState icon={Store} title="Nenhum fornecedor cadastrado" description="Cadastre fornecedores para receber ofertas de preço e enviar pesquisas de cotação." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {list.map((s) => (
            <Card key={s.id} hover>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-serif text-lg font-semibold">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[s.municipio, s.uf].filter(Boolean).join(" · ") || "—"}
                    {s.document ? ` · ${s.document}` : ""}
                  </p>
                </div>
                {s.shareable && <Badge tone="accent">pool regional</Badge>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {s.categories.map((c) => <Badge key={c} tone="neutral">{c}</Badge>)}
              </div>
              {s.offers.length > 0 && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Tabela de preços</p>
                  {s.offers.slice(0, 4).map((o) => (
                    <div key={o.id} className="flex items-center justify-between py-0.5 text-sm">
                      <span className="text-muted-foreground">{o.item}{o.unit ? ` / ${o.unit}` : ""}</span>
                      <span className="font-serif font-medium">{formatBRL(o.priceBRL)}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                {[s.email, s.phone].filter(Boolean).join(" · ") || "sem contato"}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pesquisas de preço ───────────────────────────────────────────────────────--
function Pesquisas() {
  const [list, setList] = useState<MercResearch[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  function load() { api.mercResearches().then(setList).catch(() => setList([])); }
  useEffect(load, []);

  if (!list) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button Icon={Plus} onClick={() => setCreating((c) => !c)}>Nova pesquisa</Button>
      </div>

      {creating && <NovaPesquisa onDone={() => { setCreating(false); load(); }} />}

      {list.length === 0 ? (
        <EmptyState icon={Search} title="Nenhuma pesquisa de preço" description="Crie uma pesquisa, convide fornecedores (cadastrados ou não) e compare as propostas recebidas." />
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <Card key={r.id} padded={false}>
              <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center justify-between p-5 text-left">
                <div>
                  <p className="font-serif text-lg font-semibold">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {Array.isArray(r.items) ? r.items.length : 0} item(ns) · método {r.method} · prazo {r.deadlineDays}d · criada {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={r.status === "encerrada" ? "neutral" : r.status === "em-coleta" ? "info" : "warning"}>{r.status}</Badge>
                  <Badge tone="success">{r.invitesResponded}/{r.invitesTotal} resp.</Badge>
                </div>
              </button>
              {open === r.id && <PesquisaDetalhe research={r} onChange={load} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function NovaPesquisa({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [itemsText, setItemsText] = useState("");
  const [method, setMethod] = useState("mediana");
  const [deadlineDays, setDeadlineDays] = useState("5");
  const [busy, setBusy] = useState(false);

  async function create() {
    const items = itemsText.split("\n").map((l) => l.trim()).filter(Boolean).map((description) => ({ description }));
    if (!title.trim() || items.length === 0) return;
    setBusy(true);
    try {
      await api.mercCreateResearch({ title: title.trim(), items, method, deadlineDays: Number(deadlineDays) || 5 });
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader icon={Search} title="Nova pesquisa de preço" />
      <div className="mt-4 space-y-3">
        <input className={inputClass} placeholder="Título (ex: Reposição material de escritório — jun/2026)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div>
          <label className="text-sm font-medium">Itens (um por linha)</label>
          <textarea className={`${inputClass} mt-1 min-h-24`} placeholder={"Papel A4 75g — caixa 10 resmas\nCaneta esferográfica azul — caixa 50"} value={itemsText} onChange={(e) => setItemsText(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm">Método
            <select className={`${inputClass} w-auto`} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="mediana">Mediana</option>
              <option value="media">Média</option>
              <option value="menor-preco">Menor preço</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">Prazo (dias)
            <input type="number" className={`${inputClass} w-20`} value={deadlineDays} onChange={(e) => setDeadlineDays(e.target.value)} />
          </label>
        </div>
        <Button onClick={create} disabled={busy}>{busy ? "Criando…" : "Criar pesquisa"}</Button>
      </div>
    </Card>
  );
}

function PesquisaDetalhe({ research, onChange }: { research: MercResearch; onChange: () => void }) {
  const [cons, setCons] = useState<MercConsolidation | null>(null);
  const [links, setLinks] = useState<Array<{ supplierName: string; link: string; sentVia: string }> | null>(null);
  const [suppliers, setSuppliers] = useState<MercSupplier[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [adhoc, setAdhoc] = useState({ name: "", phone: "", email: "" });
  const [busy, setBusy] = useState(false);

  function loadCons() { api.mercConsolidation(research.id).then(setCons).catch(() => {}); }
  useEffect(() => { loadCons(); api.mercSuppliers().then(setSuppliers).catch(() => {}); }, [research.id]);

  async function addAndSend() {
    setBusy(true);
    try {
      const invites: Array<{ supplierId?: string; supplierName: string; email?: string; phone?: string }> =
        suppliers.filter((s) => picked[s.id]).map((s) => ({ supplierId: s.id, supplierName: s.name, email: s.email ?? undefined, phone: s.phone ?? undefined }));
      if (adhoc.name.trim()) invites.push({ supplierName: adhoc.name.trim(), email: adhoc.email || undefined, phone: adhoc.phone || undefined });
      if (invites.length) await api.mercAddInvites(research.id, invites);
      const r = await api.mercSendInvites(research.id);
      if (r.links) setLinks(r.links);
      setAdhoc({ name: "", phone: "", email: "" }); setPicked({});
      onChange();
    } finally { setBusy(false); }
  }

  return (
    <div className="border-t border-border p-5">
      {/* Convidar fornecedores */}
      <p className="mb-2 text-sm font-medium">Convidar fornecedores</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {suppliers.map((s) => (
          <button key={s.id} onClick={() => setPicked((p) => ({ ...p, [s.id]: !p[s.id] }))}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${picked[s.id] ? "border-primary bg-accent-soft text-primary-strong" : "border-border text-muted-foreground hover:bg-muted/60"}`}>
            {s.name}
          </button>
        ))}
        {suppliers.length === 0 && <span className="text-xs text-muted-foreground">Nenhum fornecedor cadastrado — use o campo avulso abaixo.</span>}
      </div>
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input className={inputClass} placeholder="Fornecedor avulso (nome)" value={adhoc.name} onChange={(e) => setAdhoc({ ...adhoc, name: e.target.value })} />
        <input className={inputClass} placeholder="WhatsApp" value={adhoc.phone} onChange={(e) => setAdhoc({ ...adhoc, phone: e.target.value })} />
        <input className={inputClass} placeholder="E-mail" value={adhoc.email} onChange={(e) => setAdhoc({ ...adhoc, email: e.target.value })} />
      </div>
      <Button Icon={Send} onClick={addAndSend} disabled={busy}>{busy ? "Enviando…" : "Convidar e gerar links"}</Button>

      {links && (
        <div className="mt-4 space-y-2 rounded-lg bg-muted/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Links de cotação (encaminhe aos fornecedores)</p>
          {links.map((l, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{l.supplierName}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{l.sentVia}</span>
                <button onClick={() => navigator.clipboard.writeText(l.link)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <Copy size={12} /> copiar link
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Mapa comparativo / consolidação */}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">Mapa comparativo de preços</p>
          {research.status !== "encerrada" && cons && cons.items.length > 0 && (
            <Button size="sm" variant="outline" onClick={async () => { await api.mercCloseResearch(research.id); onChange(); }}>Encerrar pesquisa</Button>
          )}
        </div>
        {!cons || cons.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem cotações aprovadas ainda. Respostas dos fornecedores aparecem em "Pendentes" para aprovação e então entram aqui.</p>
        ) : (
          <div className="space-y-4">
            {cons.items.map((it) => (
              <div key={it.item} className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{it.item}</p>
                  <div className="flex items-center gap-2">
                    {it.consolidation.dispersionAlert && <Badge tone="warning"><AlertTriangle size={11} /> dispersão alta</Badge>}
                    {!it.consolidation.meetsMinimumThree && <Badge tone="neutral">menos de 3 preços</Badge>}
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  {it.quotes.map((q, i) => (
                    <div key={i} className={`flex items-center justify-between rounded px-2 py-1 text-sm ${q.isCheapest ? "bg-accent-soft" : ""}`}>
                      <span className="flex items-center gap-1.5">
                        {q.isCheapest && <Trophy size={13} className="text-primary" />}
                        {q.supplierName}
                        <span className="text-xs text-muted-foreground">({q.origin})</span>
                      </span>
                      <span className="font-serif font-medium">{formatBRL(q.unitPriceBRL)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs sm:grid-cols-4">
                  <Stat label="Menor" value={formatBRL(it.consolidation.min)} />
                  <Stat label="Mediana" value={formatBRL(it.consolidation.median)} />
                  <Stat label="Média" value={formatBRL(it.consolidation.mean)} />
                  <Stat label={`Estimativa (${it.consolidation.method})`} value={formatBRL(it.consolidation.estimate)} highlight />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={highlight ? "rounded bg-accent-soft px-2 py-1" : ""}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`font-serif text-sm font-semibold ${highlight ? "text-primary-strong" : ""}`}>{value}</p>
    </div>
  );
}

// ── Pendentes (aprovação de cotações capturadas) ───────────────────────────────
function Pendentes() {
  const [list, setList] = useState<MercPendingQuote[] | null>(null);
  function load() { api.mercPendingQuotes().then(setList).catch(() => setList([])); }
  useEffect(load, []);

  return (
    <div className="space-y-6">
      <ExtractBox onDone={load} />
      {!list ? (
        <Skeleton className="h-40 w-full" />
      ) : list.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Nada pendente" description="Cotações recebidas (formulário, WhatsApp, e-mail ou extração por IA) aparecem aqui para aprovar antes de entrarem no comparativo." />
      ) : (
        <div className="space-y-3">{list.map((q) => <PendingCard key={q.id} q={q} onChange={load} />)}</div>
      )}
    </div>
  );
}

function ExtractBox({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [text, setText] = useState("");
  const [researchId, setResearchId] = useState("");
  const [researches, setResearches] = useState<MercResearch[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (open) api.mercResearches().then(setResearches).catch(() => {}); }, [open]);

  async function run() {
    if (!supplierName.trim() || text.trim().length < 3) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.mercExtractQuote({ supplierName: supplierName.trim(), text: text.trim(), researchId: researchId || undefined });
      setMsg(r.ok ? `IA extraiu ${r.count} preço(s) → foram para a fila de aprovação.` : `Não consegui extrair: ${r.reason ?? "texto sem preço reconhecível"}`);
      if (r.ok) { setText(""); setSupplierName(""); onDone(); }
    } catch (e: any) { setMsg(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader
        icon={Sparkles}
        title="Extrair proposta com IA"
        subtitle="Cole o texto da proposta (e-mail, WhatsApp, ou transcrição de PDF). A IA identifica preços, prazo, frete e pagamento."
        action={<Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? "Fechar" : "Abrir"}</Button>}
      />
      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input className={inputClass} placeholder="Nome do fornecedor" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
            <select className={inputClass} value={researchId} onChange={(e) => setResearchId(e.target.value)}>
              <option value="">Vincular a uma pesquisa (opcional)</option>
              {researches.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </div>
          <textarea className={`${inputClass} min-h-28`} placeholder={'Ex: "Boa tarde! O cabide cx100 sai a R$ 79,90, prazo 4 dias úteis, pix antecipado."'} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex items-center gap-3">
            <Button Icon={Sparkles} onClick={run} disabled={busy}>{busy ? "Extraindo…" : "Extrair com IA"}</Button>
            {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

function PendingCard({ q, onChange }: { q: MercPendingQuote; onChange: () => void }) {
  const d = (q.details ?? {}) as Record<string, any>;
  const extras = [
    d.leadTimeDays != null ? `prazo ${d.leadTimeDays}d` : "",
    d.paymentTerms ? `pgto ${d.paymentTerms}` : "",
    d.frete ? `frete ${d.frete}` : "",
  ].filter(Boolean).join(" · ");
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{q.item}</p>
          <p className="text-xs text-muted-foreground">
            {q.supplierName} · {q.origin} · {new Date(q.createdAt).toLocaleString("pt-BR")}
            {extras ? ` · ${extras}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-serif text-lg font-semibold">{formatBRL(q.unitPriceBRL)}</span>
          <Button size="sm" variant="soft" Icon={CheckCircle2} onClick={async () => { await api.mercApproveQuote(q.id); onChange(); }}>Aprovar</Button>
          <Button size="sm" variant="danger" Icon={XCircle} onClick={async () => { await api.mercRejectQuote(q.id); onChange(); }}>Recusar</Button>
        </div>
      </div>
    </Card>
  );
}
