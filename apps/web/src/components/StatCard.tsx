import type { LucideIcon } from "lucide-react";

export function StatCard({ label, value, Icon }: { label: string; value: string; Icon: LucideIcon }) {
  return (
    <div className="rounded-lg border border-border bg-background p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon size={16} className="text-primary" />
      </div>
      <p className="mt-3 font-serif text-3xl font-bold">{value}</p>
    </div>
  );
}
