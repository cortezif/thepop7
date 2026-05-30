import { useState } from "react";
import { login, signup, tenantSlug } from "../lib/api";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // login
  const [slug, setSlug] = useState(tenantSlug());
  const [email, setEmail] = useState("");
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

  const input = "mt-1.5 w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-accent-soft";
  const label = "block text-sm font-medium text-foreground";

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Painel de marca — lado esquerdo */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-foreground p-12 text-background lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{ background: "radial-gradient(120% 80% at 20% 0%, hsl(var(--primary)) 0%, transparent 55%)" }}
        />
        <div className="relative">
          <p className="text-[11px] font-semibold uppercase tracking-luxe text-background/70">Ateliê Digital</p>
        </div>
        <div className="relative max-w-md">
          <h1 className="font-serif text-5xl font-semibold leading-[1.08] tracking-tight">
            Sua boutique,<br />conduzida com elegância.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-background/70">
            Atendimento, catálogo, pedidos e pós-venda — orquestrados por IA, com o requinte
            que a sua marca merece.
          </p>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-background/50">
          <span className="h-px w-8 bg-background/30" />
          Moda feminina de alto estilo
        </div>
      </div>

      {/* Formulário — lado direito */}
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="font-serif text-3xl font-semibold tracking-tight">
              {mode === "login" ? "Bem-vinda de volta" : "Crie sua loja"}
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {mode === "login" ? "Acesse o painel da sua boutique." : "Cadastre sua marca e comece em minutos."}
            </p>
          </div>

          {mode === "login" ? (
            <div className="space-y-4">
              <div>
                <label className={label}>Loja (identificador)</label>
                <input value={slug} onChange={(e) => setSlug(e.target.value)} className={input} placeholder="ex: lisianto" />
              </div>
              <div>
                <label className={label}>E-mail</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" className={input} placeholder="voce@sualoja.com.br" />
              </div>
              <div>
                <label className={label}>Senha</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={input} placeholder="••••••••" />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className={label}>Nome da loja</label>
                <input value={storeName} onChange={(e) => setStoreName(e.target.value)} className={input} placeholder="Boutique da Ana" />
              </div>
              <div>
                <label className={label}>Identificador (slug)</label>
                <input value={suSlug} onChange={(e) => setSuSlug(e.target.value)} className={input} placeholder="boutique-da-ana" />
              </div>
              <div>
                <label className={label}>Seu nome</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>E-mail</label>
                <input type="email" value={suEmail} onChange={(e) => setSuEmail(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>Senha (mín. 6)</label>
                <input type="password" value={suPass} onChange={(e) => setSuPass(e.target.value)} className={input} />
              </div>
            </div>
          )}

          {error && <p className="mt-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-primary-strong">{error}</p>}

          <button type="submit" disabled={busy}
            className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-opacity hover:opacity-90 disabled:opacity-50">
            {busy ? "…" : mode === "login" ? "Entrar" : "Criar loja e entrar"}
          </button>

          <button type="button"
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}
            className="mt-4 w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground">
            {mode === "login" ? "Não tem conta? Criar loja" : "Já tem conta? Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
