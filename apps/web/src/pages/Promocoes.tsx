import { useEffect, useState } from "react";
import { Megaphone, Send, Users, Mail, MessageCircle, Smartphone, CheckCircle2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Page, Card, CardHeader, Button, Badge, EmptyState, Skeleton, Tabs, inputClass } from "../components/ui";
import { api, type Campaign, type CampaignChannel } from "../lib/api";

type Tab = "campanhas" | "nova";

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
      <div className="mb-6">
        <Tabs active={tab} onChange={setTab} tabs={[
          { key: "campanhas", label: "Campanhas" },
          { key: "nova", label: "Nova campanha" },
        ]} />
      </div>
      {tab === "campanhas" ? <Lista /> : <Nova onDone={() => setTab("campanhas")} />}
    </Page>
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
            {c.onlyBuyers && <Badge tone="neutral"><Users className="h-3 w-3" /> só compradores</Badge>}
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
  const [onlyBuyers, setOnlyBuyers] = useState(false);
  const [preview, setPreview] = useState<{ total: number; withPhone: number; withEmail: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { api.segmentPreview(onlyBuyers).then(setPreview).catch(() => setPreview(null)); }, [onlyBuyers]);

  function toggle(ch: CampaignChannel) {
    setChannels((cur) => cur.includes(ch) ? cur.filter((x) => x !== ch) : [...cur, ch]);
  }

  async function save(thenSend: boolean) {
    setErr("");
    if (!title.trim() || !message.trim()) { setErr("Preencha título e mensagem."); return; }
    if (channels.length === 0) { setErr("Selecione ao menos um canal."); return; }
    setSaving(true);
    try {
      const c = await api.createCampaign({ title, message, subject: subject || undefined, channels, onlyBuyers });
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

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyBuyers} onChange={(e) => setOnlyBuyers(e.target.checked)} />
          Enviar só para quem já comprou
        </label>

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
