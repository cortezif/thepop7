import { useEffect, useState } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, MessageSquare, Package, ShoppingCart, ClipboardList, Settings as SettingsIcon, LogOut, Barcode, Sparkles, Scale, Megaphone, Boxes, ScrollText, Factory, Truck, Users2, UserCircle, BarChart3, Gift, Contact, Smile, Wallet, Bike, Menu, X } from "lucide-react";
import { cn } from "./lib/utils";
import { auth, brandName, tenantSlug, fetchMe, api, storedSegment, setStoredSegment, canManage } from "./lib/api";
import { applyBrandTheme } from "./lib/theme";
import { Login } from "./pages/Login";

type NavItem = { to: string; label: string; Icon: typeof LayoutDashboard; production?: boolean; manage?: boolean };
const NAV: NavItem[] = [
  { to: "/",         label: "Painel",        Icon: LayoutDashboard },
  { to: "/recursos", label: "Recursos",      Icon: Sparkles },
  { to: "/inbox",    label: "Atendimento",   Icon: MessageSquare },
  { to: "/catalog",  label: "Catálogo",      Icon: Package },
  { to: "/insumos",  label: "Insumos",       Icon: Boxes, production: true },
  { to: "/receitas", label: "Fichas técnicas", Icon: ScrollText, production: true },
  { to: "/producao", label: "Produção",      Icon: Factory, production: true },
  { to: "/entrega",  label: "Entrega",       Icon: Truck, production: true },
  { to: "/entregadores", label: "Entregadores", Icon: Bike },
  { to: "/relatorios-fab", label: "Relatórios fab.", Icon: BarChart3, production: true },
  { to: "/pedidos",  label: "Pedidos",       Icon: ClipboardList },
  { to: "/estoque",  label: "Estoque",       Icon: Barcode },
  { to: "/compras",  label: "Compras",       Icon: ShoppingCart },
  { to: "/financeiro", label: "Financeiro",  Icon: Wallet, manage: true },
  { to: "/mercadologica", label: "Mercadológica", Icon: Scale },
  { to: "/clientes", label: "Clientes", Icon: Contact },
  { to: "/midia-paga", label: "Mídia paga", Icon: Megaphone },
  { to: "/promocoes", label: "Promoções", Icon: Gift },
  { to: "/satisfacao", label: "Satisfação", Icon: Smile },
  { to: "/equipe",   label: "Equipe",        Icon: Users2, manage: true },
  { to: "/settings", label: "Configurações", Icon: SettingsIcon },
  { to: "/conta",    label: "Minha conta",   Icon: UserCircle },
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
  const [production, setProduction] = useState(false);
  // Drawer da navegação no mobile (no desktop a sidebar é fixa).
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Fecha o drawer ao trocar de rota (navegação no mobile).
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  // Trava o scroll do body enquanto o drawer está aberto.
  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [navOpen]);

  useEffect(() => {
    const onUnauth = () => setLoggedIn(false);
    // Mudou o tipo de negócio em Configurações → re-lê a flag de fabricação na hora.
    const onConfigChanged = () => api.getConfig().then((c) => setProduction(!!c.productionEnabled)).catch(() => {});
    window.addEventListener("hubadvisor:unauthorized", onUnauth);
    window.addEventListener("hubadvisor:config-changed", onConfigChanged);
    return () => {
      window.removeEventListener("hubadvisor:unauthorized", onUnauth);
      window.removeEventListener("hubadvisor:config-changed", onConfigChanged);
    };
  }, []);

  // Aplica o tema da loja e re-hidrata a marca ao montar (sobrevive a refresh).
  useEffect(() => {
    if (!loggedIn) return;
    // Sem flash: aplica direto a cor do segmento guardado (se houver); senão
    // mantém o default do CSS até o getConfig responder (evita pulo de cor por slug).
    const seg = storedSegment();
    if (seg) applyBrandTheme(tenantSlug(), seg);
    api.getConfig().then((c) => { setStoredSegment(c.segment); applyBrandTheme(tenantSlug(), c.segment); setProduction(!!c.productionEnabled); }).catch(() => {});
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
    const seg = storedSegment();
    if (seg) applyBrandTheme(tenantSlug(), seg);
    api.getConfig().then((c) => { setStoredSegment(c.segment); applyBrandTheme(tenantSlug(), c.segment); setProduction(!!c.productionEnabled); }).catch(() => {});
    const n = brandName();
    setBrand(n);
    if (n) document.title = n;
  }

  if (!loggedIn) return <Login onLogin={handleLogin} />;

  const displayName = brand || "Sua Loja";

  const brandMark = (size: "sm" | "md") => (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide text-primary-foreground shadow-soft",
        size === "md" ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs"
      )}
      style={{ backgroundColor: "hsl(var(--primary))" }}
    >
      {monogram(displayName)}
    </div>
  );

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[256px_1fr]">
      {/* Top bar — só no mobile/tablet. */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card/80 px-4 py-3 backdrop-blur lg:hidden">
        <button
          onClick={() => setNavOpen(true)}
          aria-label="Abrir menu"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <Menu size={20} />
        </button>
        {brandMark("sm")}
        <h1 className="min-w-0 truncate font-serif text-base font-semibold leading-tight text-foreground">{displayName}</h1>
      </header>

      {/* Backdrop do drawer (mobile). */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 transform flex-col overflow-y-auto border-r border-border bg-card px-5 py-7 transition-transform duration-200",
          "lg:static lg:z-auto lg:w-auto lg:translate-x-0 lg:bg-card/60 lg:transition-none",
          navOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Marca da loja + fechar (mobile) */}
        <div className="mb-9 flex items-center gap-3 px-1">
          {brandMark("md")}
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-serif text-lg font-semibold leading-tight text-foreground">{displayName}</h1>
            <p className="text-[10px] font-medium uppercase tracking-luxe text-muted-foreground">Painel de gestão</p>
          </div>
          <button
            onClick={() => setNavOpen(false)}
            aria-label="Fechar menu"
            className="-mr-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex flex-col gap-0.5">
          {NAV.filter((n) => (!n.production || production) && (!n.manage || canManage())).map(({ to, label, Icon }) => (
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
          className="mt-3 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <LogOut size={17} /> Sair
        </button>
      </aside>

      <main className="overflow-auto lg:h-screen">
        <Outlet />
      </main>
    </div>
  );
}
