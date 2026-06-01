import { useEffect, useState } from "react";
import { Store, PlusCircle, Pause, Play } from "lucide-react";
import { Card, CardHeader, Button, Badge, EmptyState, inputClass, Tabs } from "../components/ui";
import { PageHeader } from "../components/PageHeader";
import { formatBRL } from "../lib/utils";
import { platform, type PlatformTenant } from "../lib/api";

// Painel NÍVEL-PLATAFORMA (ADR-024): gestão de LOJAS (criar/suspender) + receita
// de comissões da rede de atacado B2B. Não é do operador da loja — autentica por
// uma CHAVE DE PLATAFORMA (x-platform-key), guardada só no navegador de quem opera.

type Summary = {
  orders: number; gmvBRL: number; commissionBRL: number;
  byStatus: Record<string, number>;
  bySeller: Array<{ sellerTenantId: string; sellerName: string; orders: number; gmvBRL: number; commissionBRL: number }>;
  recent: Array<{ orderId: string; sellerName: string; buyerRef: string; status: string; totalBRL: number; commissionBRL: number; createdAt: string }>;
};

const KEY_STORE = "hubadvisor_platform_key";
type Tab = "lojas" | "comissoes";

export function Plataforma() {
  const [key, setKey] = useState(localStorage.getItem(KEY_STORE) ?? "");
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>("lojas");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true); setErr(null);
    try {
      await platform.tenants(key); // valida a chave (401/503 → erro)
      localStorage.setItem(KEY_STORE, key.trim());
      setAuthed(true);
    } catch (e: any) { setErr(String(e?.message ?? e)); setAuthed(false); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-8 py-10">
        <PageHeader
          eyebrow="PLATAFORMA"
          title="Administração da rede"
          subtitle="Gestão de lojas e receita da rede de atacado — acesso restrito por chave de plataforma."
        />

        {/* Acesso por chave de plataforma */}
        <Card className="max-w-xl">
          <CardHeader title="Acesso da plataforma" subtitle="Sua chave fica guardada apenas neste navegador." />
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <input
              type="password" value={key} onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connect()}
              placeholder="Chave de plataforma…"
              className={inputClass + " flex-1"}
            />
            <Button onClick={connect} disabled={busy || !key.trim()}>
              {busy ? "Verificando…" : authed ? "Reconectar" : "Entrar"}
            </Button>
          </div>
          {err && (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{err}</p>
          )}
        </Card>

        {authed && (
          <>
            <div className="mt-10">
              <Tabs<Tab>
                tabs={[{ key: "lojas", label: "Lojas" }, { key: "comissoes", label: "Comissões B2B" }]}
                active={tab}
                onChange={setTab}
              />
            </div>
            {tab === "lojas" ? <LojasTab apiKey={key} /> : <ComissoesTab apiKey={key} />}
          </>
        )}
      </div>
    </div>
  );
}

// ── Aba Lojas ──────────────────────────────────────────────────────────────--

const STATUS_TONE: Record<string, "success" | "danger" | "warning"> = {
  active: "success", suspended: "danger", trial: "warning",
};
const STATUS_LABEL: Record<string, string> = { active: "Ativa", suspended: "Suspensa", trial: "Trial" };

function LojasTab({ apiKey }: { apiKey: string }) {
  const [tenants, setTenants] = useState<PlatformTenant[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    setErr(null);
    platform.tenants(apiKey).then(setTenants).catch((e) => setErr(String(e?.message ?? e)));
  }
  useEffect(load, [apiKey]);

  async function setStatus(t: PlatformTenant, status: "active" | "suspended") {
    if (!confirm(`${status === "suspended" ? "Suspender" : "Reativar"} a loja "${t.name}"?`)) return;
    try { await platform.setStatus(apiKey, t.id, status); load(); }
    catch (e: any) { setErr(String(e?.message ?? e)); }
  }

  return (
    <div className="mt-8">
      <NewStore apiKey={apiKey} onCreated={load} />

      {err && <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{err}</p>}

      <section className="mt-10">
        <h2 className="font-serif text-xl font-semibold text-foreground">Lojas da rede</h2>
        <div className="mt-1 h-px w-12 bg-gradient-to-r from-primary to-transparent" />

        {tenants && tenants.length === 0 ? (
          <div className="mt-5"><EmptyState icon={Store} title="Nenhuma loja" description="Crie a primeira loja acima." /></div>
        ) : (
          <Card padded={false} className="mt-5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-luxe text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold">Loja</th>
                  <th className="px-5 py-3 text-left font-semibold">Dono</th>
                  <th className="px-5 py-3 text-right font-semibold">Usuários</th>
                  <th className="px-5 py-3 text-right font-semibold">Pedidos</th>
                  <th className="px-5 py-3 text-center font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Ação</th>
                </tr>
              </thead>
              <tbody>
                {(tenants ?? []).map((t) => (
                  <tr key={t.id} className="border-t border-border transition-colors hover:bg-muted/30">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-foreground">{t.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">/{t.slug} · {t.segment}</p>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      <p>{t.ownerName ?? "—"}</p>
                      <p className="text-xs">{t.ownerEmail ?? ""}</p>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">{t.users}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">{t.orders}</td>
                    <td className="px-5 py-3.5 text-center">
                      <Badge tone={STATUS_TONE[t.status] ?? "neutral"}>{STATUS_LABEL[t.status] ?? t.status}</Badge>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {t.status === "suspended" ? (
                        <Button variant="outline" size="sm" Icon={Play} onClick={() => setStatus(t, "active")}>Reativar</Button>
                      ) : (
                        <Button variant="danger" size="sm" Icon={Pause} onClick={() => setStatus(t, "suspended")}>Suspender</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}

function NewStore({ apiKey, onCreated }: { apiKey: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ storeName: "", slug: "", ownerName: "", ownerEmail: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function create() {
    setBusy(true); setMsg(null);
    try {
      await platform.createTenant(apiKey, { ...f, slug: f.slug.toLowerCase() });
      setF({ storeName: "", slug: "", ownerName: "", ownerEmail: "", password: "" });
      setOpen(false); onCreated();
    } catch (e: any) { setMsg(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader
        icon={PlusCircle}
        title="Nova loja"
        subtitle="Cria a loja (tenant) e o login do dono. O dono já pode entrar e montar a equipe."
        action={<Button variant={open ? "ghost" : "primary"} onClick={() => setOpen((o) => !o)}>{open ? "Cancelar" : "Criar loja"}</Button>}
      />
      {open && (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input className={inputClass} placeholder="Nome da loja" value={f.storeName} onChange={set("storeName")} />
          <input className={inputClass} placeholder="Identificador (slug: minúsculas-e-hífen)" value={f.slug} onChange={set("slug")} />
          <input className={inputClass} placeholder="Nome do dono" value={f.ownerName} onChange={set("ownerName")} />
          <input className={inputClass} placeholder="E-mail do dono" type="email" value={f.ownerEmail} onChange={set("ownerEmail")} />
          <input className={inputClass} placeholder="Senha provisória (mín. 6)" type="text" value={f.password} onChange={set("password")} />
          <div className="sm:col-span-2">
            <Button onClick={create} disabled={busy || !f.storeName || f.slug.length < 3 || !f.ownerName || !f.ownerEmail || f.password.length < 6}>
              {busy ? "Criando…" : "Criar loja + dono"}
            </Button>
            {msg && <p className="mt-3 text-sm text-red-700">{msg}</p>}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Aba Comissões (mantém o painel B2B existente) ────────────────────────────-

function ComissoesTab({ apiKey }: { apiKey: string }) {
  const [data, setData] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    fetch("/api/platform/commissions", { headers: { "x-platform-key": apiKey.trim() } })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(setData)
      .catch((e) => setErr(String(e?.message ?? e)));
  }, [apiKey]);

  if (err) return <p className="mt-8 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{err}</p>;
  if (!data) return <p className="mt-8 text-sm text-muted-foreground">Carregando…</p>;

  return (
    <>
      <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
        <Stat label="GMV — volume transacionado" value={formatBRL(data.gmvBRL)} />
        <Stat label="Comissão da plataforma" value={formatBRL(data.commissionBRL)} accent />
        <Stat label="Pedidos B2B" value={String(data.orders)} />
      </div>

      <section className="mt-12">
        <h2 className="font-serif text-xl font-semibold text-foreground">Por vendedor</h2>
        <div className="mt-1 h-px w-12 bg-gradient-to-r from-primary to-transparent" />
        {data.bySeller.length === 0 ? (
          <div className="mt-5"><EmptyState title="Sem pedidos B2B ainda" description="As lojas vendedoras aparecerão aqui assim que houver transações na rede." /></div>
        ) : (
          <Card padded={false} className="mt-5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-luxe text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold">Loja vendedora</th>
                  <th className="px-5 py-3 text-right font-semibold">Pedidos</th>
                  <th className="px-5 py-3 text-right font-semibold">GMV</th>
                  <th className="px-5 py-3 text-right font-semibold">Comissão</th>
                </tr>
              </thead>
              <tbody>
                {data.bySeller.map((s) => (
                  <tr key={s.sellerTenantId} className="border-t border-border transition-colors hover:bg-muted/30">
                    <td className="px-5 py-3.5 font-medium text-foreground">{s.sellerName}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">{s.orders}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums">{formatBRL(s.gmvBRL)}</td>
                    <td className="px-5 py-3.5 text-right font-serif font-semibold tabular-nums text-primary-strong">{formatBRL(s.commissionBRL)}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-xl font-semibold text-foreground">Pedidos recentes</h2>
        <div className="mt-1 h-px w-12 bg-gradient-to-r from-primary to-transparent" />
        {data.recent.length === 0 ? (
          <div className="mt-5"><EmptyState title="Nenhum pedido" description="Os pedidos B2B mais recentes da rede aparecerão aqui." /></div>
        ) : (
          <Card padded={false} className="mt-5 divide-y divide-border">
            {data.recent.map((o) => (
              <div key={o.orderId} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 text-sm">
                <span className="font-mono text-xs text-muted-foreground">#{o.orderId.slice(-6)}</span>
                <span className="font-medium text-foreground">{o.sellerName}</span>
                <span className="text-xs text-muted-foreground">comprador {o.buyerRef.slice(-6)}</span>
                <Badge tone="neutral" className="uppercase tracking-wide">{o.status}</Badge>
                <span className="ml-auto tabular-nums text-foreground">{formatBRL(o.totalBRL)}</span>
                <span className="font-medium tabular-nums text-emerald-700">+{formatBRL(o.commissionBRL)}</span>
              </div>
            ))}
          </Card>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className={accent ? "border-primary/40 bg-accent-soft" : undefined}>
      <p className="text-[11px] font-semibold uppercase tracking-luxe text-muted-foreground">{label}</p>
      <p className={`mt-3 font-serif text-4xl font-semibold tabular-nums ${accent ? "text-primary-strong" : "text-foreground"}`}>
        {value}
      </p>
    </Card>
  );
}
