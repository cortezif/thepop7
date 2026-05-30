import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchPublicInvite, submitPublicQuote, type PublicInvite } from "../lib/api";
import { Card, CardHeader, Button, inputClass } from "../components/ui";
import { formatBRL } from "../lib/utils";

export function CotacaoPublica() {
  const { token = "" } = useParams();
  const [invite, setInvite] = useState<PublicInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // valores por item (preço/qtd)
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchPublicInvite(token)
      .then((d) => { setInvite(d); setDone(d.alreadyResponded); })
      .catch((e) => setErr(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit() {
    if (!invite) return;
    setBusy(true); setErr(null);
    try {
      for (let i = 0; i < invite.items.length; i++) {
        const v = Number((prices[i] ?? "").replace(",", "."));
        if (!Number.isFinite(v) || v <= 0) continue;
        await submitPublicQuote(token, { item: invite.items[i]!.description, unitPriceBRL: v, quantity: invite.items[i]!.quantity });
      }
      setDone(true);
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-xl px-6 py-12">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : err && !invite ? (
          <Card><p className="text-sm text-red-600">{err}</p></Card>
        ) : invite ? (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-luxe text-primary">{invite.storeName}</p>
            <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">Pedido de cotação</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Olá, <span className="font-medium text-foreground">{invite.supplierName}</span> — {invite.title}.
              Informe seu preço unitário por item (prazo de resposta: {invite.deadlineDays} dias).
            </p>

            {done ? (
              <Card className="mt-6">
                <CardHeader title="Cotação recebida ✓" subtitle="Obrigado! Sua proposta foi registrada e será analisada pela loja." />
              </Card>
            ) : (
              <Card className="mt-6 space-y-4">
                {invite.items.map((it, i) => (
                  <div key={i} className="flex items-center gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{it.description}</p>
                      {it.quantity && <p className="text-xs text-muted-foreground">Quantidade: {it.quantity}</p>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-muted-foreground">R$</span>
                      <input
                        inputMode="decimal"
                        value={prices[i] ?? ""}
                        onChange={(e) => setPrices((p) => ({ ...p, [i]: e.target.value }))}
                        placeholder="0,00"
                        className={`${inputClass} w-28`}
                      />
                    </div>
                  </div>
                ))}
                {err && <p className="text-sm text-red-600">{err}</p>}
                <Button onClick={submit} disabled={busy} className="w-full">
                  {busy ? "Enviando…" : "Enviar cotação"}
                </Button>
              </Card>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
