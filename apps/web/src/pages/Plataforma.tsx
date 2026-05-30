import { useState } from "react";

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
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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
    <div className="mx-auto max-w-5xl p-10">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">PLATAFORMA · REDE B2B</p>
      <h1 className="mt-1 font-serif text-2xl font-bold">Receita de comissões (atacado)</h1>

      <div className="mt-6 flex gap-2">
        <input
          type="password" value={key} onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="Chave de plataforma…"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <button onClick={load} disabled={busy || !key.trim()}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50">
          {busy ? "Carregando…" : "Carregar"}
        </button>
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      {data && (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card label="GMV (volume transacionado)" value={brl(data.gmvBRL)} />
            <Card label="Comissão da plataforma" value={brl(data.commissionBRL)} accent />
            <Card label="Pedidos B2B" value={String(data.orders)} />
          </div>

          <h2 className="mt-8 font-serif text-lg font-bold">Por vendedor</h2>
          <div className="mt-2 overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-4 py-2 text-left">Loja vendedora</th><th className="px-4 py-2 text-right">Pedidos</th><th className="px-4 py-2 text-right">GMV</th><th className="px-4 py-2 text-right">Comissão</th></tr>
              </thead>
              <tbody>
                {data.bySeller.map((s) => (
                  <tr key={s.sellerTenantId} className="border-t border-border">
                    <td className="px-4 py-2 font-medium">{s.sellerName}</td>
                    <td className="px-4 py-2 text-right">{s.orders}</td>
                    <td className="px-4 py-2 text-right">{brl(s.gmvBRL)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{brl(s.commissionBRL)}</td>
                  </tr>
                ))}
                {data.bySeller.length === 0 && <tr><td colSpan={4} className="px-4 py-3 text-muted-foreground">Sem pedidos B2B ainda.</td></tr>}
              </tbody>
            </table>
          </div>

          <h2 className="mt-8 font-serif text-lg font-bold">Pedidos recentes</h2>
          <div className="mt-2 divide-y divide-border rounded-lg border border-border">
            {data.recent.map((o) => (
              <div key={o.orderId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">#{o.orderId.slice(-6)}</span>
                <span className="font-medium">{o.sellerName}</span>
                <span className="text-xs text-muted-foreground">comprador {o.buyerRef.slice(-6)}</span>
                <span className="rounded bg-muted px-2 py-0.5 text-[10px] uppercase">{o.status}</span>
                <span className="ml-auto">{brl(o.totalBRL)}</span>
                <span className="text-emerald-700">+{brl(o.commissionBRL)}</span>
              </div>
            ))}
            {data.recent.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">Nenhum pedido.</p>}
          </div>
        </>
      )}
    </div>
  );
}

function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-5 ${accent ? "border-emerald-300 bg-emerald-50/50" : "border-border bg-background"}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-3 font-serif text-3xl font-bold ${accent ? "text-emerald-700" : ""}`}>{value}</p>
    </div>
  );
}
