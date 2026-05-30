import { useEffect, useState } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { LayoutDashboard, MessageSquare, Package, ShoppingCart, ClipboardList, Settings as SettingsIcon, LogOut, Barcode, Sparkles } from "lucide-react";
import { cn } from "./lib/utils";
import { auth, brandName, tenantSlug, fetchMe } from "./lib/api";
import { applyBrandTheme } from "./lib/theme";
import { Login } from "./pages/Login";

const NAV = [
  { to: "/",         label: "Painel",        Icon: LayoutDashboard },
  { to: "/recursos", label: "Recursos",      Icon: Sparkles },
  { to: "/inbox",    label: "Atendimento",   Icon: MessageSquare },
  { to: "/catalog",  label: "Catálogo",      Icon: Package },
  { to: "/pedidos",  label: "Pedidos",       Icon: ClipboardList },
  { to: "/estoque",  label: "Estoque",       Icon: Barcode },
  { to: "/compras",  label: "Compras",       Icon: ShoppingCart },
  { to: "/settings", label: "Configurações", Icon: SettingsIcon },
];

/** Monograma a partir do nome da loja (1–2 iniciais). */
function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function App() {
  const [loggedIn, setLoggedIn] = useState(auth.isLoggedIn());
  const [brand, setBrand] = useState(brandName());

  useEffect(() => {
    const onUnauth = () => setLoggedIn(false);
    window.addEventListener("thepop7:unauthorized", onUnauth);
    return () => window.removeEventListener("thepop7:unauthorized", onUnauth);
  }, []);

  // Aplica o tema da loja e re-hidrata a marca ao montar (sobrevive a refresh).
  useEffect(() => {
    if (!loggedIn) return;
    applyBrandTheme(tenantSlug());
    if (!brand) {
      fetchMe().then(() => {
        const n = brandName();
        if (n) { setBrand(n); document.title = n; }
      });
    } else {
      document.title = brand;
    }
  }, [loggedIn]);

  function handleLogin() {
    setLoggedIn(true);
    applyBrandTheme(tenantSlug());
    const n = brandName();
    setBrand(n);
    if (n) document.title = n;
  }

  if (!loggedIn) return <Login onLogin={handleLogin} />;

  const displayName = brand || "Sua Loja";

  return (
    <div className="grid min-h-screen grid-cols-[256px_1fr] bg-background">
      <aside className="flex flex-col border-r border-border bg-card/60 px-5 py-7">
        {/* Marca da loja */}
        <div className="mb-9 flex items-center gap-3 px-1">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold tracking-wide text-primary-foreground shadow-soft"
            style={{ backgroundColor: "hsl(var(--primary))" }}
          >
            {monogram(displayName)}
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-serif text-lg font-semibold leading-tight text-foreground">{displayName}</h1>
            <p className="text-[10px] font-medium uppercase tracking-luxe text-muted-foreground">Ateliê Digital</p>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }: { isActive: boolean }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-accent-soft text-primary-strong"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )
              }
            >
              {({ isActive }: { isActive: boolean }) => (
                <>
                  <span
                    className={cn(
                      "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary transition-opacity",
                      isActive ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <Icon size={17} className={isActive ? "text-primary" : ""} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={() => { auth.clear(); setLoggedIn(false); setBrand(""); }}
          className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <LogOut size={17} /> Sair
        </button>
      </aside>
      <main className="overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
