export function PageHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header>
      <p className="text-xs font-bold tracking-[0.25em] text-primary">{eyebrow}</p>
      <h1 className="mt-2 font-serif text-4xl font-bold tracking-tight">{title}</h1>
      <div className="mt-3 h-[3px] w-12 bg-primary" />
    </header>
  );
}
