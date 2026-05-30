import { useEffect, useState } from "react";
import { Power, Users, GitMerge, Store, CreditCard, Truck, MessageCircle, Instagram, FileText, Bot, Tag } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { api, type DuplicateGroup, type TrayStatus, type IntegrationStatus, type SegmentPreset } from "../lib/api";
import { inputClass } from "../components/ui";
import { cn } from "../lib/utils";

export function Settings() {
  return (
    <div className="mx-auto max-w-6xl p-10">
      <PageHeader eyebrow="CONFIGURAÇÕES" title="Automação & Integrações" />
      <KillSwitch />
      <SegmentConfig />
      <Retention />
      <IdentityMerge />
      <TrayIntegration />
      <MercadoPagoIntegration />
      <MelhorEnvioIntegration />
      <WhatsAppStatus />
      <InstagramStatus />
      <CPlugStatus />
      <AnthropicStatus />
    </div>
  );
}

// ── Componente genérico de status (env-var only) ─────────────────────────────

function EnvIntegration({
  icon, title, description, provider, loadFn,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  provider: string;
  loadFn: () => Promise<IntegrationStatus>;
}) {
  const [st, setSt] = useState<IntegrationStatus | null>(null);

  useEffect(() => { loadFn().then(setSt).catch(() => {}); }, []);

  const connected = st?.connected ?? false;

  return (
    <section className="mt-6 rounded-lg border border-border bg-background p-6">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-serif text-lg font-bold">{title}</h2>
        <span className={cn(
          "ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium",
          connected ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground",
        )}>
          {connected ? "Conectado" : "Desconectado"}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {st && (
        <p className={cn("mt-3 rounded-md px-3 py-2 text-xs", connected ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800")}>
          {st.note}
        </p>
      )}
    </section>
  );
}

// ── OAuth integrations ───────────────────────────────────────────────────────

function OAuthIntegration({
  icon, title, description, provider, paramKey,
  loadFn, authorizeUrlFn, refreshFn, disconnectFn,
}: {
  icon: React.ReactNode; title: string; description: string;
  provider: string; paramKey: string;
  loadFn: () => Promise<IntegrationStatus>;
  authorizeUrlFn: () => Promise<{ url: string }>;
  refreshFn: () => Promise<{ ok: boolean }>;
  disconnectFn: () => Promise<{ ok: boolean }>;
}) {
  const [st, setSt] = useState<IntegrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() { loadFn().then(setSt).catch((e) => setErr(String(e))); }

  useEffect(() => {
    load();
    const p = new URLSearchParams(window.location.search);
    const v = p.get(paramKey);
    if (v === "ok") setMsg(`${title} conectado com sucesso ✓`);
    if (v === "erro") setErr(`Falha ao conectar: ${p.get("motivo") ?? "desconhecido"}`);
    if (v) window.history.replaceState({}, "", "/settings");
  }, []);

  async function connect() {
    setErr(null); setMsg(null); setBusy(true);
    try {
      const { url } = await authorizeUrlFn();
      window.location.href = url;
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true); setErr(null); setMsg(null);
    try { await refreshFn(); setMsg("Token renovado ✓"); load(); }
    catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true); setErr(null); setMsg(null);
    try { await disconnectFn(); setMsg("Desconectado."); load(); }
    catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  const connected = st?.connected ?? false;
  const appConfigured = (st as any)?.appConfigured;
  const envToken = (st as any)?.envToken;

  return (
    <section className="mt-6 rounded-lg border border-border bg-background p-6">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-serif text-lg font-bold">{title}</h2>
        <span className={cn(
          "ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium",
          connected ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground",
        )}>
          {connected ? "Conectado" : "Desconectado"}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>

      {envToken && !connected && (
        <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Token de ambiente detectado — conecte via OAuth para associar à esta loja.
        </p>
      )}

      {st && appConfigured === false && !envToken && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {st.note ?? `Configure as credenciais do app ${title} no servidor para habilitar o OAuth.`}
        </p>
      )}

      {connected ? (
        <div className="mt-4 flex gap-2">
          <button onClick={refresh} disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
            Renovar token
          </button>
          <button onClick={disconnect} disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
            Desconectar
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <button
            onClick={connect}
            disabled={busy || (appConfigured === false && !envToken)}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50">
            {busy ? "Redirecionando…" : `Conectar ${title}`}
          </button>
        </div>
      )}

      {msg && <p className="mt-3 text-sm text-emerald-700">{msg}</p>}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </section>
  );
}

// ── Integrações específicas ──────────────────────────────────────────────────

function TrayIntegration() {
  const [st, setSt] = useState<TrayStatus | null>(null);
  const [apiAddress, setApiAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() { api.trayStatus().then(setSt).catch((e) => setErr(String(e))); }
  useEffect(() => {
    load();
    const p = new URLSearchParams(window.location.search);
    const tray = p.get("tray");
    if (tray === "ok") setMsg("Tray conectada com sucesso ✓");
    if (tray === "erro") setErr(`Falha ao conectar: ${p.get("motivo") ?? "desconhecido"}`);
    if (tray) window.history.replaceState({}, "", "/settings");
  }, []);

  async function connect() {
    setErr(null); setMsg(null);
    const addr = apiAddress.trim();
    if (!/^https?:\/\//.test(addr)) { setErr("Informe a URL web_api da loja (https://...)"); return; }
    setBusy(true);
    try {
      const { url } = await api.trayAuthorizeUrl(addr);
      window.location.href = url;
    } catch (e: any) { setErr(String(e?.message ?? e)); setBusy(false); }
  }

  async function refresh() {
    setBusy(true); setErr(null); setMsg(null);
    try { await api.trayRefresh(); setMsg("Token renovado ✓"); load(); }
    catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true); setErr(null); setMsg(null);
    try { await api.trayDisconnect(); setMsg("Tray desconectada."); load(); }
    catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  const connected = st?.connected;
  return (
    <section className="mt-10 rounded-lg border border-border bg-background p-6">
      <div className="flex items-center gap-2">
        <Store className="h-5 w-5 text-muted-foreground" />
        <h2 className="font-serif text-lg font-bold">Tray Commerce (ERP / catálogo)</h2>
        <span className={cn("ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium",
          connected ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground")}>
          {connected ? "Conectada" : st?.status === "error" ? "Erro" : "Desconectada"}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">A loja usa Tray. Conecte para sincronizar produtos, estoque e pedidos.</p>
      {st && !st.appConfigured && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Defina <code>TRAY_CONSUMER_KEY</code> e <code>TRAY_CONSUMER_SECRET</code> no servidor para habilitar a conexão.
        </p>
      )}
      {connected ? (
        <div className="mt-4 space-y-1 text-sm">
          <p>Loja: <span className="font-medium">{st?.storeId ?? "—"}</span></p>
          <p className="text-muted-foreground">web_api: {st?.apiAddress}</p>
          {st?.accessExpiresAt && (
            <p className="text-xs text-muted-foreground">Token expira em {new Date(st.accessExpiresAt).toLocaleString("pt-BR")}</p>
          )}
          <div className="mt-3 flex gap-2">
            <button onClick={refresh} disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">Renovar token</button>
            <button onClick={disconnect} disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">Desconectar</button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input value={apiAddress} onChange={(e) => setApiAddress(e.target.value)}
            placeholder="https://sualoja.commercesuite.com.br/web_api"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <button onClick={connect} disabled={busy || (st != null && !st.appConfigured)}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50">
            {busy ? "Redirecionando…" : "Conectar Tray"}
          </button>
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-emerald-700">{msg}</p>}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {st?.lastError && !err && <p className="mt-2 text-xs text-red-500">Último erro: {st.lastError}</p>}
    </section>
  );
}

function MercadoPagoIntegration() {
  return (
    <OAuthIntegration
      icon={<CreditCard className="h-5 w-5 text-muted-foreground" />}
      title="Mercado Pago"
      description="Pagamentos via PIX, cartão e boleto. Conecte para gerar cobranças reais."
      provider="mercadopago"
      paramKey="mp"
      loadFn={() => api.integrationStatus("mercadopago")}
      authorizeUrlFn={() => api.integrationAuthorize("mercadopago")}
      refreshFn={() => api.integrationRefresh("mercadopago")}
      disconnectFn={() => api.integrationDisconnect("mercadopago")}
    />
  );
}

function MelhorEnvioIntegration() {
  return (
    <OAuthIntegration
      icon={<Truck className="h-5 w-5 text-muted-foreground" />}
      title="Melhor Envio"
      description="Cotação e geração de etiquetas de frete. Conecte para calcular frete real nas vendas."
      provider="melhor-envio"
      paramKey="me"
      loadFn={() => api.integrationStatus("melhor-envio")}
      authorizeUrlFn={() => api.integrationAuthorize("melhor-envio")}
      refreshFn={() => api.integrationRefresh("melhor-envio")}
      disconnectFn={() => api.integrationDisconnect("melhor-envio")}
    />
  );
}

function WhatsAppStatus() {
  return (
    <EnvIntegration
      icon={<MessageCircle className="h-5 w-5 text-muted-foreground" />}
      title="WhatsApp Business Cloud API"
      description="Canal de atendimento principal. Configure as variáveis de ambiente após aprovação Meta."
      provider="whatsapp"
      loadFn={() => api.integrationStatus("whatsapp")}
    />
  );
}

function InstagramStatus() {
  return (
    <EnvIntegration
      icon={<Instagram className="h-5 w-5 text-muted-foreground" />}
      title="Instagram Graph API"
      description="Canal de atendimento via Direct. Configure após aprovação Meta."
      provider="instagram"
      loadFn={() => api.integrationStatus("instagram")}
    />
  );
}

function CPlugStatus() {
  return (
    <EnvIntegration
      icon={<FileText className="h-5 w-5 text-muted-foreground" />}
      title="CPlug (NFe / gestão fiscal)"
      description="Emissão de notas fiscais eletrônicas. Configure as credenciais da loja no servidor."
      provider="cplug"
      loadFn={() => api.integrationStatus("cplug")}
    />
  );
}

function AnthropicStatus() {
  return (
    <EnvIntegration
      icon={<Bot className="h-5 w-5 text-muted-foreground" />}
      title="Anthropic Claude (IA)"
      description="Motor de IA das personas Maya, Bia e Lia. Configure ANTHROPIC_API_KEY no servidor."
      provider="anthropic"
      loadFn={() => api.integrationStatus("anthropic")}
    />
  );
}

// ── Kill Switch ──────────────────────────────────────────────────────────────

function KillSwitch() {
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [maxBRL, setMaxBRL] = useState<string>("");
  const [savedMax, setSavedMax] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingMax, setSavingMax] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then((c) => {
      setAiEnabled(c.aiEnabled);
      setSavedMax(c.autoApproveMaxBRL);
      setMaxBRL(String(c.autoApproveMaxBRL));
    }).catch((e) => setError(String(e)));
  }, []);

  async function saveMax() {
    const v = Number(maxBRL);
    if (!Number.isFinite(v) || v < 0) { setError("Valor inválido"); return; }
    setSavingMax(true); setError(null);
    try {
      const r = await api.setAutoApprove(v);
      setSavedMax(r.autoApproveMaxBRL);
    } catch (e) { setError(String(e)); }
    finally { setSavingMax(false); }
  }

  async function toggle() {
    if (aiEnabled === null) return;
    setBusy(true); setError(null);
    try {
      const r = await api.toggleAI(!aiEnabled);
      setAiEnabled(r.aiEnabled);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const on = aiEnabled === true;
  return (
    <div className="mt-8 rounded-lg border border-border bg-background p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-3">
          <Power size={20} className={cn("mt-0.5", on ? "text-green-600" : "text-primary")} />
          <div>
            <p className="font-semibold">Atendimento por IA (Maya)</p>
            <p className="text-xs text-muted-foreground">
              {aiEnabled === null ? "Carregando…"
                : on ? "Ativo — a Maya responde automaticamente às mensagens que chegam."
                : "Pausado — toda mensagem que chega vai direto pra fila de atendimento humano."}
            </p>
          </div>
        </div>
        <button onClick={toggle} disabled={busy || aiEnabled === null}
          className={cn("rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50",
            on ? "bg-primary text-primary-foreground" : "bg-green-600 text-white")}>
          {busy ? "…" : on ? "Pausar IA (kill-switch)" : "Reativar IA"}
        </button>
      </div>
      {!on && aiEnabled !== null && (
        <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">
          A IA está pausada. Mensagens recebidas não recebem resposta automática — assuma manualmente no Atendimento.
        </p>
      )}
      <div className="mt-5 border-t border-border pt-4">
        <p className="text-sm font-medium">Limite de auto-aprovação</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Pedidos até este valor a Maya fecha sozinha. Acima disso, vai pra confirmação de um atendente.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">R$</span>
          <input type="number" value={maxBRL} onChange={(e) => setMaxBRL(e.target.value)}
            className="w-32 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary" />
          <button onClick={saveMax} disabled={savingMax || Number(maxBRL) === savedMax}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50">
            {savingMax ? "Salvando…" : "Salvar"}
          </button>
          {savedMax !== null && Number(maxBRL) === savedMax && (
            <span className="text-xs text-muted-foreground">salvo</span>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-primary">Erro: {error}</p>}
    </div>
  );
}

// ── Tipo de negócio / segmento (ADR-029, multi-segmento) ─────────────────────
function SegmentConfig() {
  const [presets, setPresets] = useState<SegmentPreset[]>([]);
  const [segment, setSegment] = useState("moda");
  const [styles, setStyles] = useState("");
  const [occasions, setOccasions] = useState("");
  const [applyVoice, setApplyVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.segmentPresets().then(setPresets).catch(() => {});
    api.getConfig().then((c) => {
      setSegment(c.segment ?? "moda");
      setStyles((c.catalogVocab?.styles ?? []).join(", "));
      setOccasions((c.catalogVocab?.occasions ?? []).join(", "));
    }).catch(() => {});
  }, []);

  // Trocar de tipo de negócio prefila o vocabulário do preset (editável).
  function pick(id: string) {
    setSegment(id);
    const p = presets.find((x) => x.id === id);
    if (p) {
      setStyles(p.styles.join(", "));
      setOccasions(p.occasions.join(", "));
      setApplyVoice(true); // por padrão adota a linguagem de IA do segmento
    }
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const toList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
      const r = await api.setSegment({ segment: segment.trim() || "moda", styles: toList(styles), occasions: toList(occasions), applyVoice });
      setMsg(`Salvo: ${r.segment}${r.voiceApplied ? " · linguagem da IA aplicada" : ""}.`);
    } catch (e) { setMsg(String(e)); } finally { setBusy(false); }
  }

  const current = presets.find((p) => p.id === segment);
  const known = presets.some((p) => p.id === segment);

  return (
    <div className="mt-6 rounded-lg border border-border bg-background p-6">
      <div className="flex items-center gap-2">
        <Tag size={18} className="text-primary" />
        <h2 className="font-serif text-lg font-bold">Tipo de negócio</h2>
      </div>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">
        Define a <strong>cor da marca</strong>, o <strong>vocabulário do catálogo</strong> e a
        <strong> linguagem da IA</strong>. Escolha um tipo pronto (prefila tudo, editável) ou digite um próprio.
      </p>

      {/* Chips de tipo de negócio */}
      <div className="mb-4 flex flex-wrap gap-2">
        {presets.map((p) => (
          <button key={p.id} onClick={() => pick(p.id)}
            className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              segment === p.id ? "border-primary bg-accent-soft text-primary-strong" : "border-border text-muted-foreground hover:bg-muted")}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <label className="block text-sm font-medium">Identificador do segmento
          <input value={segment} onChange={(e) => setSegment(e.target.value.toLowerCase())} placeholder="moda" className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">Estilos / categorias
          <input value={styles} onChange={(e) => setStyles(e.target.value)} placeholder="ex: aniversário, casamento, infantil" className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">Ocasiões / usos
          <input value={occasions} onChange={(e) => setOccasions(e.target.value)} placeholder="ex: aniversário, chá, corporativo" className={inputClass + " mt-1"} />
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={applyVoice} onChange={(e) => setApplyVoice(e.target.checked)} className="mt-0.5" disabled={!known} />
          <span>
            Adotar a <strong>linguagem da IA</strong> deste segmento
            {current && <span className="mt-1 block rounded bg-muted/50 px-2 py-1 text-xs text-muted-foreground">“{current.aiVoice.slice(0, 160)}…”</span>}
          </span>
        </label>

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {busy ? "Salvando…" : "Salvar tipo de negócio"}
          </button>
          {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Retention ────────────────────────────────────────────────────────────────

function Retention() {
  const [conv, setConv] = useState<string>("");
  const [order, setOrder] = useState<string>("");
  const [preview, setPreview] = useState<{ mensagensAfetadas?: number; pedidosAfetados?: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const c = await api.getConfig();
    setConv(c.retentionDays == null ? "" : String(c.retentionDays));
    setOrder(c.orderRetentionDays == null ? "" : String(c.orderRetentionDays));
    if (c.retentionDays != null || c.orderRetentionDays != null) setPreview(await api.retentionPreview());
  }
  useEffect(() => { load().catch((e) => setMsg(String(e))); }, []);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const parse = (s: string) => (s.trim() === "" ? null : Number(s));
      const rd = parse(conv), od = parse(order);
      if ((rd != null && (!Number.isInteger(rd) || rd < 1)) || (od != null && (!Number.isInteger(od) || od < 1))) {
        setMsg("Use dias inteiros ≥ 1 (ou vazio = desativado)"); setBusy(false); return;
      }
      await api.setRetention({ retentionDays: rd, orderRetentionDays: od });
      setPreview(await api.retentionPreview());
      setMsg("Política salva.");
    } catch (e) { setMsg(String(e)); } finally { setBusy(false); }
  }

  async function run() {
    if (!confirm("Anonimizar conversas/pedidos além do prazo? Ação irreversível.")) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.retentionRun();
      setMsg(r.ok ? `Anonimizadas ${r.mensagensAnonimizadas ?? 0} mensagem(ns) e ${r.pedidosAnonimizados ?? 0} pedido(s).` : `Não executado: ${r.reason}`);
      setPreview(await api.retentionPreview());
    } catch (e) { setMsg(String(e)); } finally { setBusy(false); }
  }

  const fld = "w-24 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary";
  return (
    <div className="mt-6 rounded-lg border border-border bg-background p-6">
      <div className="flex items-center gap-2">
        <Power size={18} className="text-primary" />
        <h2 className="font-serif text-lg font-bold">Retenção de dados (LGPD)</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Após o prazo, o conteúdo é anonimizado. Vazio = desativado. Sugerido: conversas 540 dias, pedidos 1825 dias.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm">
          Conversas <input type="number" value={conv} onChange={(e) => setConv(e.target.value)} placeholder="dias" className={fld} />
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          Pedidos <input type="number" value={order} onChange={(e) => setOrder(e.target.value)} placeholder="dias" className={fld} />
        </label>
        <button onClick={save} disabled={busy}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50">Salvar</button>
      </div>
      {preview && (
        <div className="mt-3 flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {preview.mensagensAfetadas ?? 0} mensagem(ns) · {preview.pedidosAfetados ?? 0} pedido(s) elegíveis.
          </span>
          <button onClick={run} disabled={busy || (!preview.mensagensAfetadas && !preview.pedidosAfetados)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">Executar agora</button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-muted-foreground">{msg}</p>}
    </div>
  );
}

// ── Identity Merge ───────────────────────────────────────────────────────────

function IdentityMerge() {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try { setGroups(await api.duplicateContacts()); }
    catch (e) { setError(String(e)); }
  }
  useEffect(() => { load(); }, []);

  async function merge(g: DuplicateGroup) {
    if (g.contacts.length < 2) return;
    setBusy(g.contacts[0]!.id); setError(null);
    try {
      for (let i = 1; i < g.contacts.length; i++) {
        await api.mergeContacts(g.contacts[0]!.id, g.contacts[i]!.id);
      }
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  const label = (s: string) => ({ phone: "telefone", ig: "Instagram", email: "e-mail", cpf: "CPF", nome: "nome parecido" }[s] ?? s);

  return (
    <div className="mt-6 rounded-lg border border-border bg-background p-6">
      <div className="flex items-center gap-2">
        <Users size={18} className="text-primary" />
        <h2 className="font-serif text-lg font-bold">Identidades cross-canal</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Contatos que parecem a mesma pessoa. Fundir une histórico, pedidos e perfil.
      </p>
      {groups === null ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma identidade duplicada encontrada. 🎉</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g, i) => (
            <div key={i} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {g.contacts.length} contatos · {g.sharedBy === "nome" ? label(g.sharedBy) : `mesmo ${label(g.sharedBy)}`}
                  {g.confidence === "baixa" && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">revise — baixa confiança</span>
                  )}
                </span>
                <button onClick={() => merge(g)} disabled={busy === g.contacts[0]!.id}
                  className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
                  <GitMerge size={12} /> {busy === g.contacts[0]!.id ? "Fundindo…" : "Fundir"}
                </button>
              </div>
              <div className="mt-2 space-y-1">
                {g.contacts.map((c) => (
                  <p key={c.id} className="text-sm">
                    {c.name ?? "(sem nome)"}{" "}
                    <span className="text-xs text-muted-foreground">
                      {[c.phone, c.igHandle, c.email].filter(Boolean).join(" · ")}
                    </span>
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-primary">Erro: {error}</p>}
    </div>
  );
}
