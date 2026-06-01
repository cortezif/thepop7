import type { ReactNode, ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

/* ============================================================================
   Kit de UI — linguagem visual sofisticada (boutique de moda de alto estilo).
   Neutros quentes (marfim/tinta), cartões elevados, acento de marca por loja.
   ========================================================================== */

// ── Card ─────────────────────────────────────────────────────────────────────
export function Card({
  className, children, hover, padded = true,
}: { className?: string; children: ReactNode; hover?: boolean; padded?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card shadow-soft",
        hover && "transition-shadow hover:shadow-lift",
        padded && "p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  icon: Icon, title, subtitle, action, className,
}: { icon?: LucideIcon; title: string; subtitle?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-primary">
            <Icon size={17} />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="font-serif text-lg font-semibold leading-tight text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ── Button ───────────────────────────────────────────────────────────────────
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost" | "danger" | "soft";
  size?: "sm" | "md";
  Icon?: LucideIcon;
};

export function Button({
  variant = "primary", size = "md", Icon, className, children, ...rest
}: ButtonProps) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all disabled:opacity-50 disabled:pointer-events-none";
  const sizes = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2.5 text-sm" };
  const variants = {
    primary: "bg-primary text-primary-foreground shadow-soft hover:opacity-90",
    outline: "border border-border bg-card text-foreground hover:bg-muted/60",
    ghost:   "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    danger:  "border border-red-200 bg-card text-red-600 hover:bg-red-50",
    soft:    "bg-accent-soft text-primary-strong hover:opacity-90",
  };
  return (
    <button className={cn(base, sizes[size], variants[variant], className)} {...rest}>
      {Icon && <Icon size={size === "sm" ? 14 : 16} />}
      {children}
    </button>
  );
}

// ── Badge ────────────────────────────────────────────────────────────────────
type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";
export function Badge({
  tone = "neutral", children, className,
}: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  const tones: Record<BadgeTone, string> = {
    neutral: "bg-muted text-muted-foreground",
    success: "bg-emerald-100 text-emerald-800",
    warning: "bg-amber-100 text-amber-800",
    danger:  "bg-red-100 text-red-700",
    info:    "bg-sky-100 text-sky-800",
    accent:  "bg-accent-soft text-primary-strong",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

// ── EmptyState ─────────────────────────────────────────────────────────────--
export function EmptyState({
  icon: Icon, title, description, action,
}: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      {Icon && (
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-primary">
          <Icon size={24} />
        </span>
      )}
      <p className="font-serif text-lg font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

// ── Input / textarea (estilo padrão) ─────────────────────────────────────────
export const inputClass =
  "w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-accent-soft placeholder:text-muted-foreground/60";

// ── Tabs simples ──────────────────────────────────────────────────────────────
export function Tabs<T extends string>({
  tabs, active, onChange,
}: { tabs: { key: T; label: string; count?: number }[]; active: T; onChange: (k: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-muted/40 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 py-1.5 text-sm font-medium transition-all",
            active === t.key ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
          {t.count != null && (
            <span className={cn("rounded-full px-1.5 text-[11px]", active === t.key ? "bg-accent-soft text-primary-strong" : "bg-muted text-muted-foreground")}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Page wrapper (largura/respiro consistentes) ───────────────────────────────
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10 lg:px-10", className)}>{children}</div>;
}
