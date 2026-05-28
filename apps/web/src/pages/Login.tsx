import { useState } from "react";
import { login, signup, tenantSlug } from "../lib/api";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // login
  const [slug, setSlug] = useState(tenantSlug());
  const [email, setEmail] = useState("admin@thepop7.local");
  const [password, setPassword] = useState("");

  // signup
  const [storeName, setStoreName] = useState("");
  const [suSlug, setSuSlug] = useState("");
  const [name, setName] = useState("");
  const [suEmail, setSuEmail] = useState("");
  const [suPass, setSuPass] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === "login") {
        await login(email.trim(), password, slug);
      } else {
        await signup({ storeName: storeName.trim(), slug: suSlug.trim().toLowerCase(), name: name.trim(), email: suEmail.trim(), password: suPass });
      }
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const input = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-border bg-background p-8 shadow-sm">
        <p className="text-xs font-bold tracking-[0.2em] text-primary">THE POP 7</p>
        <h1 className="mt-1 font-serif text-2xl font-bold">{mode === "login" ? "Entrar no painel" : "Criar loja"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "login" ? "Acesso de operador da loja." : "Cadastre sua loja e comece a usar."}
        </p>

        {mode === "login" ? (
          <>
            <label className="mt-6 block text-sm font-medium">Loja (identificador)</label>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} className={input} placeholder="ex: minha-loja" />
            <label className="mt-4 block text-sm font-medium">E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" className={input} />
            <label className="mt-4 block text-sm font-medium">Senha</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={input} />
          </>
        ) : (
          <>
            <label className="mt-6 block text-sm font-medium">Nome da loja</label>
            <input value={storeName} onChange={(e) => setStoreName(e.target.value)} className={input} placeholder="Boutique da Ana" />
            <label className="mt-4 block text-sm font-medium">Identificador (slug)</label>
            <input value={suSlug} onChange={(e) => setSuSlug(e.target.value)} className={input} placeholder="boutique-da-ana" />
            <label className="mt-4 block text-sm font-medium">Seu nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
            <label className="mt-4 block text-sm font-medium">E-mail</label>
            <input type="email" value={suEmail} onChange={(e) => setSuEmail(e.target.value)} className={input} />
            <label className="mt-4 block text-sm font-medium">Senha (mín. 6)</label>
            <input type="password" value={suPass} onChange={(e) => setSuPass(e.target.value)} className={input} />
          </>
        )}

        {error && <p className="mt-3 text-sm text-primary">{error}</p>}

        <button type="submit" disabled={busy} className="mt-6 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {busy ? "…" : mode === "login" ? "Entrar" : "Criar loja e entrar"}
        </button>

        <button
          type="button"
          onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}
          className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          {mode === "login" ? "Não tem conta? Criar loja" : "Já tem conta? Entrar"}
        </button>
      </form>
    </div>
  );
}
