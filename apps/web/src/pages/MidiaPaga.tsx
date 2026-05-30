import { useEffect, useState } from "react";
import { Megaphone, Plus, Sparkles, Play, Pause, RefreshCw, Users } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Page, Card, CardHeader, Button, Badge, EmptyState, Skeleton, Tabs, inputClass } from "../components/ui";
import { api, type AdAudience, type AdCampaign, type IntegrationStatus } from "../lib/api";
import { formatBRL } from "../lib/utils";

type Tab = "campanhas" | "nova" | "publicos";
const OBJECTIVES = [
  { key: "mensagens", label: "Mensagens (Click-to-WhatsApp/Direct)" },
  { key: "vendas", label: "Vendas" },
  { key: "trafego", label: "Tráfego" },
  { key: "reconhecimento", label: "Reconhecimento" },
];

export function MidiaPaga() {
  const [tab, setTab] = useState<Tab>("campanhas");
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  useEffect(() => { api.adsStatus().then(setStatus).catch(() => {}); }, []);

  return (
    <Page>
      <PageHeader eyebrow="MÍDIA PAGA · THEO" title="Anúncios" subtitle="Crie e gerencie campanhas no Facebook e Instagram com IA. Criativo gerado pelo Theo, públicos a partir dos seus próprios dados." />

      {status && !status.connected && (
        <div className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Modo simulado — {status.note} As campanhas e métricas abaixo são demonstrativas até a Meta Marketing API ser conectada.
        </div>
      )}

      <div className="mb-6">
        <Tabs active={tab} onChange={setTab} tabs={[
          { key: "campanhas", label: "Campanhas" },
          { key: "nova", label: "Nova campanha" },
          { key: "publicos", label: "Públicos" },
        ]} />
      </div>

      {tab === "campanhas" && <Campanhas />}
      {tab === "nova" && <NovaCampanha onDone={() => setTab("campanhas")} />}
      {tab === "publicos" && <Publicos />}
    </Page>
  );
}

function statusTone(s: string) {
  return s === "ativa" ? "success" : s === "pausada" ? "warning" : s === "encerrada" ? "neutral" : "info";
}

function Campanhas() {
  const [list, setList] = useState<AdCampaign[] | null>(null);
  function load() { api.adsCampaigns().then(setList).catch(() => setList([])); }
  useEffect(load, []);

  if (!list) return <Skeleton className="h-40 w-full" />;
  if (list.length === 0) return <EmptyState icon={Megaphone} title="Nenhuma campanha" description="Crie sua primeira campanha na aba 'Nova campanha'. O Theo escreve o criativo e sugere o público." />;

  return (
    <div className="space-y-4">
      {list.map((c) => (
        <Card key={c.id}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-serif text-lg font-semibold">{c.name}</p>
                <Badge tone={statusTone(c.status)}>{c.status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{c.objective} · {formatBRL(c.dailyBudgetBRL)}/dia{c.audience?.label ? ` · ${c.audience.label}` : ""}</p>
              {c.creative?.headline && (
                <div className="mt-2 rounded-md bg-muted/40 p-3 text-sm">
                  <p className="font-medium">{c.creative.headline}</p>
                  <p className="text-muted-foreground">{c.creative.primaryText}</p>
                  {c.creative.cta && <Badge tone="accent" className="mt-1">{c.creative.cta}</Badge>}
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {c.status === "ativa"
                ? <Button size="sm" variant="outline" Icon={Pause} onClick={async () => { await api.adsSetStatus(c.id, "pausada"); load(); }}>Pausar</Button>
                : <Button size="sm" variant="soft" Icon={Play} onClick={async () => { await api.adsSetStatus(c.id, "ativa"); load(); }}>Ativar</Button>}
              <Button size="sm" variant="ghost" Icon={RefreshCw} onClick={async () => { await api.adsRefreshInsights(c.id); load(); }}>Atualizar métricas</Button>
            </div>
          </div>
          {c.metrics && (
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-center sm:grid-cols-5">
              <Metric label="Impressões" value={c.metrics.impressions.toLocaleString("pt-BR")} />
              <Metric label="Cliques" value={c.metrics.clicks.toLocaleString("pt-BR")} />
              <Metric label="CTR" value={`${(c.metrics.ctr * 100).toFixed(2)}%`} />
              <Metric label="Investido" value={formatBRL(c.metrics.spendBRL)} />
              <Metric label="ROAS" value={`${c.metrics.roas.toFixed(2)}x`} highlight />
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={highlight ? "rounded bg-accent-soft px-2 py-1" : ""}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`font-serif text-base font-semibold ${highlight ? "text-primary-strong" : ""}`}>{value}</p>
    </div>
  );
}

function NovaCampanha({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("mensagens");
  const [budget, setBudget] = useState("20");
  const [offer, setOffer] = useState("");
  const [audiences, setAudiences] = useState<AdAudience[]>([]);
  const [audienceKey, setAudienceKey] = useState("");
  const [creative, setCreative] = useState<{ headline: string; primaryText: string; cta: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { api.adsAudiences().then(setAudiences).catch(() => {}); }, []);
  const audience = audiences.find((a) => a.key === audienceKey);

  async function gerar() {
    if (offer.trim().length < 2) { setMsg("Descreva o que será anunciado."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await api.adsGenerateCreative({ objective, productOrOffer: offer.trim(), audienceLabel: audience?.label });
      if (r.ok && r.creative) { setCreative(r.creative); setMsg(null); }
      else setMsg(`Theo não gerou criativo: ${r.error ?? "verifique a chave Anthropic"}`);
    } catch (e: any) { setMsg(String(e?.message ?? e)); } finally { setBusy(false); }
  }

  async function criar() {
    if (!name.trim()) { setMsg("Dê um nome à campanha."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await api.adsCreateCampaign({
        name: name.trim(), objective, dailyBudgetBRL: Number(budget) || 0,
        audience: audience ? { label: audience.label, definition: audience.definition } : undefined,
        creative: creative ?? undefined,
      });
      if (r.ok) { onDone(); } else setMsg("Não foi possível criar.");
    } catch (e: any) { setMsg(String(e?.message ?? e)); } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader icon={Megaphone} title="Nova campanha" subtitle="Sobe pausada — você revisa e ativa quando quiser." />
      <div className="mt-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input className={inputClass} placeholder="Nome da campanha" value={name} onChange={(e) => setName(e.target.value)} />
          <select className={inputClass} value={objective} onChange={(e) => setObjective(e.target.value)}>
            {OBJECTIVES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm">Orçamento diário (R$)
            <input type="number" className={`${inputClass} w-28`} value={budget} onChange={(e) => setBudget(e.target.value)} />
          </label>
          <select className={inputClass} value={audienceKey} onChange={(e) => setAudienceKey(e.target.value)}>
            <option value="">Público (opcional)</option>
            {audiences.map((a) => <option key={a.key} value={a.key}>{a.label} (~{a.size})</option>)}
          </select>
        </div>
        <textarea className={`${inputClass} min-h-20`} placeholder="O que anunciar? Ex: 'Coleção de inverno com 20% off na primeira compra'" value={offer} onChange={(e) => setOffer(e.target.value)} />

        <div className="flex items-center gap-3">
          <Button variant="soft" Icon={Sparkles} onClick={gerar} disabled={busy}>{busy ? "Gerando…" : "Gerar criativo com o Theo"}</Button>
          {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
        </div>

        {creative && (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pré-visualização do criativo</p>
            <p className="mt-1 font-serif text-lg font-semibold">{creative.headline}</p>
            <p className="mt-1 text-sm text-muted-foreground">{creative.primaryText}</p>
            <Badge tone="accent" className="mt-2">{creative.cta}</Badge>
          </div>
        )}

        <Button Icon={Plus} onClick={criar} disabled={busy}>Criar campanha (pausada)</Button>
      </div>
    </Card>
  );
}

function Publicos() {
  const [list, setList] = useState<AdAudience[] | null>(null);
  useEffect(() => { api.adsAudiences().then(setList).catch(() => setList([])); }, []);
  if (!list) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Públicos derivados dos seus próprios dados (perfil, conversas, pedidos, NPS) — o diferencial que ferramentas externas não têm (ADR-028).</p>
      {list.map((a) => (
        <Card key={a.key}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-primary"><Users size={16} /></span>
              <div>
                <p className="font-medium">{a.label}</p>
                <p className="text-xs text-muted-foreground">~{a.size} contatos</p>
              </div>
            </div>
            <Badge tone="neutral">{a.size}</Badge>
          </div>
        </Card>
      ))}
    </div>
  );
}
