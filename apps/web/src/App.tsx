import { useEffect, useState } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { LayoutDashboard, MessageSquare, Package, ShoppingCart, ClipboardList, Settings as SettingsIcon, LogOut, Barcode } from "lucide-react";
import { cn } from "./lib/utils";
import { auth } from "./lib/api";
import { Login } from "./pages/Login";

const NAV = [
  { to: "/",         label: "Painel",       Icon: LayoutDashboard },
  { to: "/inbox",    label: "Atendimento",  Icon: MessageSquare },
  { to: "/catalog",  label: "Catálogo",     Icon: Package },
  { to: "/pedidos",  label: "Pedidos",      Icon: ClipboardList },
  { to: "/estoque",  label: "Estoque",      Icon: Barcode },
  { to: "/compras",  label: "Compras",      Icon: ShoppingCart },
  { to: "/settings", label: "Configurações", Icon: SettingsIcon },
];

export function App() {
  const [loggedIn, setLoggedIn] = useState(auth.isLoggedIn());

  useEffect(() => {
    const onUnauth = () => setLoggedIn(false);
    window.addEventListener("thepop7:unauthorized", onUnauth);
    return () => window.removeEventListener("thepop7:unauthorized", onUnauth);
  }, []);

  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-background">
      <aside className="flex flex-col border-r border-border bg-muted/30 p-6">
        <div className="mb-8">
          <p className="text-xs font-bold tracking-[0.2em] text-primary">THE POP 7</p>
          <h1 className="mt-1 font-serif text-xl font-bold text-foreground">Painel</h1>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }: { isActive: boolean }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => { auth.clear(); setLoggedIn(false); }}
          className="mt-auto flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut size={16} /> Sair
        </button>
      </aside>
      <main className="overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
