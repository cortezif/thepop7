import { useEffect, useState } from "react";
import { Megaphone, Send, Users, Mail, MessageCircle, Smartphone, CheckCircle2, Gift } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { Page, Card, CardHeader, Button, Badge, EmptyState, Skeleton, Tabs, inputClass } from "../components/ui";
import { api, type Campaign, type CampaignChannel, type CampaignAudience, type MarketingReport } from "../lib/api";
import { formatBRL } from "../lib/utils";

type Tab = "campanhas" | "nova" | "resultados";

const CHANNELS: { key: CampaignChannel; label: string; Icon: typeof Mail }[] = [
  { key: "whatsapp", label: "WhatsApp", Icon: MessageCircle },
  { key: "email", label: "E-mail", Icon: Mail },
  { key: "sms", label: "SMS", Icon: Smartphone },
];

export function Promocoes() {
  const [tab, setTab] = useState<Tab>("campanhas");
  return (
    <Page>
      <PageHeader
        eyebrow="MARKETING · CASHBACK"
        title="Promoções"
        subtitle="Envie promoções e avisos de cashback para seus clientes por WhatsApp, e-mail e SMS. Só recebe quem consentiu — quem optou por sair de marketing fica de fora automaticamente (LGPD)."
      />
      <CashbackNudge />

      <div className="mb-6">
        <Tabs active={tab} onChange={setTab} tabs={[
          { key: "campanhas", label: "Campanhas" },
          { key: "nova", label: "Nova campanha" },
          { key: "resultados", label: "Resultados" },
        ]} />
      </div>
      {tab === "campanhas" && <Lista />}
      {tab === "nova" && <Nova onDone={() => setTab("campanhas")} />}
      {tab === "resultados" && <Resultados />}
    </Page>
  );
}

function Resultados() {
  const [rep, setRep] = useState<MarketingReport | null>(null);
  useEffect(() => { api.marketingReport().then(setRep).catch(() => setRep(null)); }, []);
  if (!rep) return <Skeleton className="h-64" />;
  const cb = rep.cashback;
  const pct = Math.round(cb.redemptionRate * 100);
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Cashback</h3>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Creditado (total)" value={formatBRL(cb.accruedBRL)} Icon={Gift} />
          <StatCard label="Resgatado" value={formatBRL(cb.redeemedBRL)} Icon={CheckCircle2} />
          <StatCard label="Expirado" value={formatBRL(cb.expiredBRL)} Icon={Megaphone} alert={cb.expiredBRL > 0} />
          <StatCard label="Taxa de resgate" value={`${pct}%`} Icon={Send} />
        </div>
      </div>
      <Card className="border-amber-200 bg-amber-50/50">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="font-medium text-foreground">Passivo em aberto: {formatBRL(cb.activeBalanceBRL)}</p>
            <p className="text-sm text-muted-foreground">
              Saldo vivo de {cb.contactsWithBalance} cliente(s). <b className="text-amber-700">{formatBRL(cb.expiring30BRL)}</b> vence nos próximos 30 dias —
              é o gancho para trazer essas pessoas de volta.
            </p>
          </div>
        </div>
      </Card>
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Campanhas</h3>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Enviadas" value={`${rep.campaigns.sent}/${rep.campaigns.total}`} Icon={Megaphone} />
          <StatCard label="Destinatários" value={String(rep.campaigns.recipients)} Icon={Users} />
          <StatCard label="Por WhatsApp" value={String(rep.campaigns.sentWhatsapp)} Icon={MessageCircle} />
          <StatCard label="Por e-mail / SMS" value={`${rep.campaigns.sentEmail} / ${rep.campaigns.sentSms}`} Icon={Mail} />
        </div>
      </div>
    </div>
  );
}

function CashbackNudge() {
  const [pv, setPv] = useState<{ contacts: number; totalBRL: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function load() { api.cashbackNudgePreview(5).then(setPv).catch(() => setPv(null)); }
  useEffect(load, []);

  async function run() {
    setBusy(true); setMsg("");
    try {
      const r = await api.sendCashbackNudge(5);
      setMsg(`Lembretes enviados a ${r.contacts} cliente(s) · WhatsApp ${r.sentWhatsapp} · e-mail ${r.sentEmail} · SMS ${r.sentSms}.`);
      load();
    } catch (e: any) { setMsg(e?.message ?? "falha ao enviar"); }
    finally { setBusy(false); }
  }

  if (!pv) return null;
  return (
    <Card className="mb-6 border-amber-200 bg-amber-50/50">
      <div className="flex flex-wrap items-center gap-4 p-5">
        <Gift className="h-6 w-6 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">Cashback a vencer (próximos 5 dias)</p>
          <p className="text-sm text-muted-foreground">
            {pv.contacts > 0
              ? <><b className="text-foreground">{pv.contacts}</b> cliente(s) com <b className="text-foreground">{pv.totalBRL.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</b> prestes a expirar. O lembrete também roda sozinho 1x/dia.</>
              : "Nenhum crédito vencendo nos próximos 5 dias."}
          </p>
          {msg && <p className="mt-1 text-sm text-emerald-700">{msg}</p>}
        </div>
        <Button onClick={run} disabled={busy || pv.contacts === 0}>
          <Send className="h-4 w-4" /> {busy ? "Enviando…" : "Enviar lembretes agora"}
        </Button>
      </div>
    </Card>
  );
}

function Lista() {
  const [list, setList] = useState<Campaign[] | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [err, setErr] = useState("");

  function load() { api.campaigns().then(setList).catch(() => setList([])); }
  useEffect(load, []);

  async function send(id: string) {
    setErr(""); setSending(id);
    try { await api.sendCampaign(id); load(); }
    catch (e: any) { setErr(e?.message ?? "falha ao enviar"); }
    finally { setSending(null); }
  }

  if (!list) return <Skeleton className="h-40" />;
  if (list.length === 0) return <EmptyState icon={Megaphone} title="Nenhuma campanha" description="Crie sua primeira campanha na aba “Nova campanha”." />;

  return (
    <div className="space-y-3">
      {err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>}
      {list.map((c) => (
        <Card key={c.id}>
          <CardHeader
            title={c.title}
            subtitle={c.message.length > 90 ? c.message.slice(0, 90) + "…" : c.message}
            action={
              c.status === "rascunho"
                ? <Button onClick={() => send(c.id)} disabled={sending === c.id}>
                    <Send className="h-4 w-4" /> {sending === c.id ? "Enviando…" : "Enviar agora"}
                  </Button>
                : <Badge tone="success"><CheckCircle2 className="h-3.5 w-3.5" /> Enviada</Badge>
            }
          />
          <div className="flex flex-wrap items-center gap-2 px-5 pb-4 text-xs text-muted-foreground">
            {c.channels.map((ch) => {
              const meta = CHANNELS.find((x) => x.key === ch)!;
              return <Badge key={ch} tone="neutral"><meta.Icon className="h-3 w-3" /> {meta.label}</Badge>;
            })}
            {c.audience === "compradores" && <Badge tone="neutral"><Users className="h-3 w-3" /> compradores</Badge>}
            {c.audience === "inativos" && <Badge tone="accent"><Users className="h-3 w-3" /> recompra · {c.inactiveDays}d+ inativos</Badge>}
            {c.status === "enviada" && (
              <span className="ml-auto">
                {c.recipients} contatos · WhatsApp {c.sentWhatsapp} · e-mail {c.sentEmail} · SMS {c.sentSms}
                {c.skipped > 0 && ` · ${c.skipped} sem canal`}
              </span>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Nova({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [channels, setChannels] = useState<CampaignChannel[]>(["whatsapp"]);
  const [audience, setAudience] = useState<CampaignAudience>("todos");
  const [inactiveDays, setInactiveDays] = useState(60);
  const [preview, setPreview] = useState<{ total: number; withPhone: number; withEmail: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setPreview(null);
    api.segmentPreview(audience, audience === "inativos" ? inactiveDays : undefined).then(setPreview).catch(() => setPreview(null));
  }, [audience, inactiveDays]);

  function toggle(ch: CampaignChannel) {
    setChannels((cur) => cur.includes(ch) ? cur.filter((x) => x !== ch) : [...cur, ch]);
  }

  async function save(thenSend: boolean) {
    setErr("");
    if (!title.trim() || !message.trim()) { setErr("Preencha título e mensagem."); return; }
    if (channels.length === 0) { setErr("Selecione ao menos um canal."); return; }
    setSaving(true);
    try {
      const c = await api.createCampaign({ title, message, subject: subject || undefined, channels, audience, inactiveDays: audience === "inativos" ? inactiveDays : undefined });
      if (thenSend) await api.sendCampaign(c.id);
      onDone();
    } catch (e: any) { setErr(e?.message ?? "falha ao salvar"); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader title="Nova campanha" subtitle="Mensagem única enviada ao segmento escolhido." />
      <div className="space-y-4 px-5 pb-5">
        {err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>}

        <div>
          <label className="mb-1 block text-sm font-medium">Título (interno)</label>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Cashback vencendo — outubro" />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Mensagem</label>
          <textarea className={inputClass} rows={4} value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="Ex.: Oi! Você tem R$ de cashback esperando. Aproveite antes que expire 💛" />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Canais</label>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map(({ key, label, Icon }) => (
              <button key={key} type="button" onClick={() => toggle(key)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  channels.includes(key) ? "border-primary bg-accent-soft text-primary-strong" : "border-border text-muted-foreground hover:bg-muted/60"
                }`}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
        </div>

        {channels.includes("email") && (
          <div>
            <label className="mb-1 block text-sm font-medium">Assunto do e-mail</label>
            <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="(usa o título se vazio)" />
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">Público</label>
          <div className="flex flex-wrap gap-2">
            {([
              { key: "todos", label: "Todos os clientes" },
              { key: "compradores", label: "Quem já comprou" },
              { key: "inativos", label: "Recompra (inativos)" },
            ] as { key: CampaignAudience; label: string }[]).map((a) => (
              <button key={a.key} type="button" onClick={() => setAudience(a.key)}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  audience === a.key ? "border-primary bg-accent-soft text-primary-strong" : "border-border text-muted-foreground hover:bg-muted/60"
                }`}>
                {a.label}
              </button>
            ))}
          </div>
          {audience === "inativos" && (
            <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              Sem comprar há
              <input type="number" min={1} className={`${inputClass} w-20`} value={inactiveDays}
                onChange={(e) => setInactiveDays(Math.max(1, Number(e.target.value) || 1))} />
              dias ou mais. Respeita o opt-out de “recompra”.
            </div>
          )}
        </div>

        {preview && (
          <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <Users className="mr-1 inline h-4 w-4" />
            <b className="text-foreground">{preview.total}</b> contatos elegíveis ·
            {" "}{preview.withPhone} com telefone (WhatsApp/SMS) · {preview.withEmail} com e-mail
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={() => save(true)} disabled={saving}>
            <Send className="h-4 w-4" /> {saving ? "Enviando…" : "Criar e enviar"}
          </Button>
          <Button variant="ghost" onClick={() => save(false)} disabled={saving}>Salvar rascunho</Button>
        </div>
      </div>
    </Card>
  );
}
