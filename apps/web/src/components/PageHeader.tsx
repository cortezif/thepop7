export function PageHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <header className="mb-6 sm:mb-8">
      <p className="text-[11px] font-semibold uppercase tracking-luxe text-primary">{eyebrow}</p>
      <h1 className="mt-2.5 font-serif text-3xl font-semibold leading-[1.1] tracking-tight text-foreground text-balance sm:text-[2.5rem]">
        {title}
      </h1>
      {subtitle && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
      <div className="mt-4 h-px w-16 bg-gradient-to-r from-primary to-transparent" />
    </header>
  );
}
