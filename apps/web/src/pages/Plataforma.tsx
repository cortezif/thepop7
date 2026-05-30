import { useState } from "react";
import { Card, CardHeader, Button, Badge, EmptyState, inputClass } from "../components/ui";
import { PageHeader } from "../components/PageHeader";
import { formatBRL } from "../lib/utils";

// Painel NÍVEL-PLATAFORMA (ADR-024): receita de comissões da rede de atacado B2B.
// Não é do operador da loja — autentica por uma CHAVE DE PLATAFORMA (x-platform-key),
// guardada só no navegador de quem opera a plataforma.

type Summary = {
  orders: number; gmvBRL: number; commissionBRL: number;
  byStatus: Record<string, number>;
  bySeller: Array<{ sellerTenantId: string; sellerName: string; orders: number; gmvBRL: number; commissionBRL: number }>;
  recent: Array<{ orderId: string; sellerName: string; buyerRef: string; status: string; totalBRL: number; commissionBRL: number; createdAt: string }>;
};

const KEY_STORE = "thepop7_platform_key";

export function Plataforma() {
  const [key, setKey] = useState(localStorage.getItem(KEY_STORE) ?? "");
  const [data, setData] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/platform/commissions", { headers: { "x-platform-key": key.trim() } });
      if (res.status === 401) throw new Error("Chave de plataforma inválida.");
      if (res.status === 503) throw new Error("Painel desabilitado no servidor (defina PLATFORM_ADMIN_KEY).");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      localStorage.setItem(KEY_STORE, key.trim());
      setData(await res.json());
    } catch (e: any) { setErr(String(e?.message ?? e)); setData(null); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-8 py-10">
        <PageHeader
          eyebrow="REDE B2B"
          title="Receita de comissões"
          subtitle="Painel executivo da rede de atacado — acesso restrito por chave de plataforma."
        />

        {/* Acesso por chave de plataforma */}
        <Card className="max-w-xl">
          <CardHeader
            title="Acesso da plataforma"
            subtitle="Sua chave fica guardada apenas neste navegador."
          />
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <input
              type="password" value={key} onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              placeholder="Chave de plataforma…"
              className={inputClass + " flex-1"}
            />
            <Button onClick={load} disabled={busy || !key.trim()}>
              {busy ? "Carregando…" : "Carregar"}
            </Button>
          </div>
          {err && (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {err}
            </p>
          )}
        </Card>

        {data && (
          <>
            {/* Métricas em destaque */}
            <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
              <Stat label="GMV — volume transacionado" value={formatBRL(data.gmvBRL)} />
              <Stat label="Comissão da plataforma" value={formatBRL(data.commissionBRL)} accent />
              <Stat label="Pedidos B2B" value={String(data.orders)} />
            </div>

            {/* Por vendedor */}
            <section className="mt-12">
              <h2 className="font-serif text-xl font-semibold text-foreground">Por vendedor</h2>
              <div className="mt-1 h-px w-12 bg-gradient-to-r from-primary to-transparent" />

              {data.bySeller.length === 0 ? (
                <div className="mt-5">
                  <EmptyState title="Sem pedidos B2B ainda" description="As lojas vendedoras aparecerão aqui assim que houver transações na rede." />
                </div>
              ) : (
                <Card padded={false} className="mt-5 overflow-hidden">
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
                </Card>
              )}
            </section>

            {/* Pedidos recentes */}
            <section className="mt-12">
              <h2 className="font-serif text-xl font-semibold text-foreground">Pedidos recentes</h2>
              <div className="mt-1 h-px w-12 bg-gradient-to-r from-primary to-transparent" />

              {data.recent.length === 0 ? (
                <div className="mt-5">
                  <EmptyState title="Nenhum pedido" description="Os pedidos B2B mais recentes da rede aparecerão aqui." />
                </div>
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
        )}
      </div>
    </div>
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
