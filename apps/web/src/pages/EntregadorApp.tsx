import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Bike, MapPin, Check, Package, PartyPopper } from "lucide-react";
import { fetchCourierApp, courierJobAction, type CourierAppData, type DeliveryJob } from "../lib/api";

const NEXT: Record<string, { action: "aceitar" | "coletar" | "entregar"; label: string }> = {
  atribuido: { action: "aceitar", label: "Aceitar corrida" },
  aceito: { action: "coletar", label: "Coletei o pedido" },
  coletado: { action: "entregar", label: "Entreguei ✓" },
};

export function EntregadorApp() {
  const { token = "" } = useParams();
  const [data, setData] = useState<CourierAppData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  function load() { fetchCourierApp(token).then(setData).catch(() => setError("Link inválido ou desativado.")); }
  useEffect(load, [token]);

  async function act(job: DeliveryJob) {
    const n = NEXT[job.status];
    if (!n) return;
    setBusy(job.id);
    try { await courierJobAction(token, job.id, n.action); load(); }
    catch { /* noop */ } finally { setBusy(null); }
  }

  if (error) return <Centered><p className="text-muted-foreground">{error}</p></Centered>;
  if (!data) return <Centered><p className="text-muted-foreground">Carregando…</p></Centered>;

  return (
    <div className="mx-auto min-h-screen max-w-md bg-background px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground"><Bike className="h-5 w-5" /></div>
        <div>
          <h1 className="font-serif text-lg font-semibold text-foreground">Olá, {data.courier.name.split(" ")[0]}!</h1>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Suas entregas</p>
        </div>
      </div>

      {data.jobs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card/60 p-8 text-center">
          <PartyPopper className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-muted-foreground">Nenhuma entrega no momento. Bom descanso! 💛</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.jobs.map((job) => {
            const n = NEXT[job.status];
            return (
              <div key={job.id} className="rounded-xl border border-border bg-card p-4 shadow-soft">
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p className="font-medium text-foreground">{job.address ?? "Endereço com a loja"}</p>
                </div>
                {job.feeBRL != null && <p className="mt-1 pl-6 text-sm text-emerald-600">Você recebe R$ {job.feeBRL.toFixed(2)}</p>}
                {job.notes && <p className="mt-1 pl-6 text-sm text-muted-foreground">{job.notes}</p>}
                <div className="mt-3 flex items-center gap-2">
                  <StatusPill status={job.status} />
                  {n && (
                    <button
                      onClick={() => act(job)}
                      disabled={busy === job.id}
                      className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {job.status === "atribuido" ? <Check className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                      {busy === job.id ? "…" : n.label}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-8 text-center text-[11px] text-muted-foreground">Guarde este link — é o seu acesso às entregas.</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = { atribuido: "Nova", aceito: "Aceita", coletado: "A caminho" };
  return <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{map[status] ?? status}</span>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-background px-4">{children}</div>;
}
