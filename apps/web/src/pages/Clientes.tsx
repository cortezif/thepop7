import { useEffect, useState } from "react";
import { Users, UserPlus, Search, Gift, ShoppingBag, MessageCircle, Mail, ShieldCheck, BellOff } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { Page, Card, CardHeader, Button, Badge, EmptyState, Skeleton, inputClass } from "../components/ui";
import { api, type ContactRow, type ContactStats } from "../lib/api";
import { formatBRL } from "../lib/utils";

export function Clientes() {
  const [stats, setStats] = useState<ContactStats | null>(null);
  const [rows, setRows] = useState<ContactRow[] | null>(null);
  const [q, setQ] = useState("");
  const [optedOut, setOptedOut] = useState(false);
  const [withCashback, setWithCashback] = useState(false);
  const [adding, setAdding] = useState(false);

  function loadStats() { api.contactStats().then(setStats).catch(() => setStats(null)); }
  function load() {
    setRows(null);
    api.contacts({ q: q || undefined, optedOut, withCashback }).then(setRows).catch(() => setRows([]));
  }
  useEffect(loadStats, []);
  useEffect(load, [optedOut, withCashback]);

  return (
    <Page>
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          eyebrow="CRM · CLIENTES"
          title="Clientes"
          subtitle="Cadastro de clientes para promoções e cashback. Gerencie consentimento e opt-out (LGPD) — só recebe quem permitiu."
        />
        <Button className="mt-2 shrink-0" onClick={() => setAdding((v) => !v)}><UserPlus className="h-4 w-4" /> Novo cliente</Button>
      </div>

      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Clientes" value={String(stats.total)} Icon={Users} />
          <StatCard label="Com cashback" value={String(stats.withCashback)} Icon={Gift} />
          <StatCard label="Alcance WhatsApp" value={String(stats.reachableWhatsapp)} Icon={MessageCircle} />
          <StatCard label="Opt-out marketing" value={String(stats.optedOutMarketing)} Icon={BellOff} alert={stats.optedOutMarketing > 0} />
        </div>
      )}

      {adding && <NovoCliente onDone={() => { setAdding(false); loadStats(); load(); }} />}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input className={`${inputClass} pl-9`} placeholder="Buscar por nome ou @instagram…"
              value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={withCashback} onChange={(e) => setWithCashback(e.target.checked)} /> Com cashback</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={optedOut} onChange={(e) => setOptedOut(e.target.checked)} /> Opt-out marketing</label>
          <Button variant="outline" onClick={load}>Buscar</Button>
        </div>
      </Card>

      {!rows ? <Skeleton className="h-64" />
        : rows.length === 0 ? <EmptyState icon={Users} title="Nenhum cliente" description="Cadastre clientes ou eles surgem automaticamente ao conversar/comprar." />
        : <Lista rows={rows} onChange={() => { loadStats(); }} />}
    </Page>
  );
}

function Lista({ rows, onChange }: { rows: ContactRow[]; onChange: () => void }) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Contato</th>
              <th className="px-4 py-3 text-right">Cashback</th>
              <th className="px-4 py-3 text-right">Pedidos</th>
              <th className="px-4 py-3 text-right">Total gasto</th>
              <th className="px-4 py-3 text-center">Marketing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => <Row key={c.id} c={c} onChange={onChange} />)}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Row({ c, onChange }: { c: ContactRow; onChange: () => void }) {
  const [optedOut, setOptedOut] = useState(c.optOuts.includes("marketing"));
  const [busy, setBusy] = useState(false);

  async function toggleMarketing() {
    setBusy(true);
    const next = optedOut
      ? c.optOuts.filter((o) => o !== "marketing")
      : [...new Set([...c.optOuts, "marketing"])];
    try { await api.setContactConsent(c.id, { optOuts: next }); setOptedOut(!optedOut); c.optOuts = next; onChange(); }
    catch { /* noop */ }
    finally { setBusy(false); }
  }

  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3">
        <div className="font-medium text-foreground">{c.name ?? "—"}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {c.consentLGPD ? <Badge tone="success"><ShieldCheck className="h-3 w-3" /> consentido</Badge> : <span>sem consentimento</span>}
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        <div className="flex flex-col gap-0.5">
          {c.phoneMasked && <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" /> {c.phoneMasked}</span>}
          {c.emailMasked && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {c.emailMasked}</span>}
          {c.igHandle && <span>@{c.igHandle}</span>}
          {!c.phoneMasked && !c.emailMasked && !c.igHandle && "—"}
        </div>
      </td>
      <td className="px-4 py-3 text-right">{c.cashbackBRL > 0 ? <span className="font-medium text-emerald-600">{formatBRL(c.cashbackBRL)}</span> : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-4 py-3 text-right text-muted-foreground"><span className="inline-flex items-center gap-1"><ShoppingBag className="h-3 w-3" /> {c.ordersCount}</span></td>
      <td className="px-4 py-3 text-right text-muted-foreground">{c.totalSpentBRL > 0 ? formatBRL(c.totalSpentBRL) : "—"}</td>
      <td className="px-4 py-3 text-center">
        <button onClick={toggleMarketing} disabled={busy}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            optedOut ? "bg-muted text-muted-foreground" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          }`}>
          {optedOut ? "Opt-out" : "Recebe"}
        </button>
      </td>
    </tr>
  );
}

function NovoCliente({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setErr("");
    if (!phone.trim() && !email.trim()) { setErr("Informe telefone ou e-mail."); return; }
    setSaving(true);
    try {
      const r = await api.createContact({ name: name || undefined, phone: phone || undefined, email: email || undefined, consentLGPD: consent });
      if (!r.created) setErr("Cliente já existe (telefone/e-mail).");
      else onDone();
    } catch (e: any) { setErr(e?.message ?? "falha ao salvar"); }
    finally { setSaving(false); }
  }

  return (
    <Card className="mb-4">
      <CardHeader title="Novo cliente" subtitle="Telefone em formato internacional (ex.: 5583999990000)." />
      <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
        {err && <div className="md:col-span-2 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>}
        <input className={inputClass} placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputClass} placeholder="Telefone (E.164)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input className={inputClass} placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          Cliente consentiu receber promoções (LGPD)
        </label>
        <div className="md:col-span-2">
          <Button onClick={save} disabled={saving}><UserPlus className="h-4 w-4" /> {saving ? "Salvando…" : "Cadastrar"}</Button>
        </div>
      </div>
    </Card>
  );
}
