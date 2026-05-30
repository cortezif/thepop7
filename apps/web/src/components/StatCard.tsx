import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

export function StatCard({ label, value, Icon, alert }: { label: string; value: string; Icon: LucideIcon; alert?: boolean }) {
  return (
    <div
      className={cn(
        "group rounded-xl border bg-card p-5 shadow-soft transition-shadow hover:shadow-lift",
        alert ? "border-amber-300 bg-amber-50/60" : "border-border"
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon size={15} className={alert ? "text-amber-600" : "text-primary"} />
      </div>
      <p className={cn("mt-3 font-serif text-[1.75rem] font-semibold leading-none", alert && "text-amber-700")}>{value}</p>
    </div>
  );
}
