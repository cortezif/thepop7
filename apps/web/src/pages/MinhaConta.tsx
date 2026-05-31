import { useState } from "react";
import { KeyRound } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Card, CardHeader, Button, Badge, inputClass } from "../components/ui";
import { team, currentRole, brandName, type Role } from "../lib/api";

const ROLE_LABEL: Record<Role, string> = { owner: "Dono", admin: "Administrador", operator: "Operador" };

export function MinhaConta() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const role = currentRole();

  async function save() {
    if (next !== confirm) { setMsg({ ok: false, text: "A confirmação não confere com a nova senha." }); return; }
    setBusy(true); setMsg(null);
    try {
      await team.changeOwnPassword(current, next);
      setCurrent(""); setNext(""); setConfirm("");
      setMsg({ ok: true, text: "Senha alterada com sucesso ✓" });
    } catch (e: any) { setMsg({ ok: false, text: String(e?.message ?? e) }); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-2xl p-10">
      <PageHeader eyebrow="CONTA" title="Minha conta" subtitle="Seus dados de acesso a esta loja." />

      <Card>
        <CardHeader title="Sessão" subtitle={brandName() || "Sua loja"} action={<Badge tone="accent">{ROLE_LABEL[role]}</Badge>} />
      </Card>

      <Card className="mt-6">
        <CardHeader icon={KeyRound} title="Trocar senha" subtitle="Informe a senha atual e escolha uma nova (mínimo 6 caracteres)." />
        <div className="mt-5 flex flex-col gap-3">
          <input className={inputClass} type="password" placeholder="Senha atual" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <input className={inputClass} type="password" placeholder="Nova senha" value={next} onChange={(e) => setNext(e.target.value)} />
          <input className={inputClass} type="password" placeholder="Confirmar nova senha" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <div>
            <Button onClick={save} disabled={busy || !current || next.length < 6 || !confirm}>
              {busy ? "Salvando…" : "Alterar senha"}
            </Button>
          </div>
          {msg && (
            <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>
          )}
        </div>
      </Card>
    </div>
  );
}
