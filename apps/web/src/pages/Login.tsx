import { useState } from "react";
import { login } from "../lib/api";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("admin@thepop7.local");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await login(email.trim(), password);
      onLogin();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-border bg-background p-8 shadow-sm">
        <p className="text-xs font-bold tracking-[0.2em] text-primary">THE POP 7</p>
        <h1 className="mt-1 font-serif text-2xl font-bold">Entrar no painel</h1>
        <p className="mt-1 text-sm text-muted-foreground">Acesso de operador da loja.</p>

        <label className="mt-6 block text-sm font-medium">E-mail</label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username"
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />

        <label className="mt-4 block text-sm font-medium">Senha</label>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />

        {error && <p className="mt-3 text-sm text-primary">{error}</p>}

        <button
          type="submit" disabled={busy || !password}
          className="mt-6 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
