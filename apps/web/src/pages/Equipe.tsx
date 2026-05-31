import { useEffect, useState } from "react";
import { UserPlus, KeyRound, Trash2, Shield } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Card, CardHeader, Button, Badge, EmptyState, inputClass } from "../components/ui";
import { team, currentRole, type TeamUser, type Role } from "../lib/api";

const ROLE_LABEL: Record<Role, string> = { owner: "Dono", admin: "Administrador", operator: "Operador" };
const ROLE_TONE: Record<Role, "accent" | "info" | "neutral"> = { owner: "accent", admin: "info", operator: "neutral" };

export function Equipe() {
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const myRole = currentRole();
  const iAmOwner = myRole === "owner";

  function load() {
    setErr(null);
    team.list().then(setUsers).catch((e) => setErr(String(e?.message ?? e)));
  }
  useEffect(load, []);

  return (
    <div className="mx-auto max-w-5xl p-10">
      <PageHeader
        eyebrow="CONTA"
        title="Equipe da loja"
        subtitle="Convide operadores, defina o papel de cada um e redefina senhas. Apenas donos e administradores acessam esta área."
      />

      <NewMember iAmOwner={iAmOwner} onCreated={load} />

      {err && (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{err}</p>
      )}

      <section className="mt-10">
        <h2 className="font-serif text-xl font-semibold text-foreground">Membros</h2>
        <div className="mt-1 h-px w-12 bg-gradient-to-r from-primary to-transparent" />

        {users && users.length === 0 ? (
          <div className="mt-5"><EmptyState icon={Shield} title="Nenhum membro" description="Adicione o primeiro operador acima." /></div>
        ) : (
          <div className="mt-5 flex flex-col gap-3">
            {(users ?? []).map((u) => (
              <MemberRow key={u.id} user={u} iAmOwner={iAmOwner} onChanged={load} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function NewMember({ iAmOwner, onCreated }: { iAmOwner: boolean; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function create() {
    setBusy(true); setMsg(null);
    try {
      await team.create({ name: name.trim(), email: email.trim(), role, password });
      setName(""); setEmail(""); setPassword(""); setRole("operator"); setOpen(false);
      onCreated();
    } catch (e: any) { setMsg(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <Card className="mt-2">
      <CardHeader
        icon={UserPlus}
        title="Adicionar membro"
        subtitle="Cria um login para a equipe operar o painel desta loja."
        action={<Button variant={open ? "ghost" : "primary"} onClick={() => setOpen((o) => !o)}>{open ? "Cancelar" : "Novo membro"}</Button>}
      />
      {open && (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input className={inputClass} placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={inputClass} placeholder="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="operator">Operador</option>
            <option value="admin">Administrador</option>
            {iAmOwner && <option value="owner">Dono</option>}
          </select>
          <input className={inputClass} placeholder="Senha provisória (mín. 6)" type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="sm:col-span-2">
            <Button onClick={create} disabled={busy || !name.trim() || !email.trim() || password.length < 6}>
              {busy ? "Criando…" : "Criar acesso"}
            </Button>
            {msg && <p className="mt-3 text-sm text-red-700">{msg}</p>}
          </div>
        </div>
      )}
    </Card>
  );
}

function MemberRow({ user, iAmOwner, onChanged }: { user: TeamUser; iAmOwner: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [newPass, setNewPass] = useState("");

  // admin não mexe em quem é owner; só owner concede/altera o papel owner.
  const canEditRole = iAmOwner || user.role !== "owner";

  async function changeRole(role: Role) {
    setBusy(true); setMsg(null);
    try { await team.update(user.id, { role }); onChanged(); }
    catch (e: any) { setMsg(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }
  async function resetPassword() {
    setBusy(true); setMsg(null);
    try { await team.resetPassword(user.id, newPass); setResetting(false); setNewPass(""); setMsg("Senha redefinida ✓"); }
    catch (e: any) { setMsg(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm(`Remover ${user.name}? Esta ação não pode ser desfeita.`)) return;
    setBusy(true); setMsg(null);
    try { await team.remove(user.id); onChanged(); }
    catch (e: any) { setMsg(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <Card padded={false} className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{user.name}</p>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        </div>

        {canEditRole ? (
          <select
            className={inputClass + " w-auto"}
            value={user.role}
            disabled={busy}
            onChange={(e) => changeRole(e.target.value as Role)}
          >
            <option value="operator">Operador</option>
            <option value="admin">Administrador</option>
            {iAmOwner && <option value="owner">Dono</option>}
          </select>
        ) : (
          <Badge tone={ROLE_TONE[user.role]}>{ROLE_LABEL[user.role]}</Badge>
        )}

        <Button variant="outline" size="sm" Icon={KeyRound} onClick={() => setResetting((r) => !r)}>Senha</Button>
        <Button variant="danger" size="sm" Icon={Trash2} onClick={remove} disabled={busy}>Remover</Button>
      </div>

      {resetting && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input className={inputClass + " flex-1"} placeholder="Nova senha (mín. 6)" type="text" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
          <Button size="sm" onClick={resetPassword} disabled={busy || newPass.length < 6}>Salvar senha</Button>
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
    </Card>
  );
}
