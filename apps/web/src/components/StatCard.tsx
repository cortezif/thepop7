import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

export function StatCard({ label, value, Icon, alert }: { label: string; value: string; Icon: LucideIcon; alert?: boolean }) {
  return (
    <div className={cn("rounded-lg border bg-background p-5", alert ? "border-amber-300 bg-amber-50/50" : "border-border")}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon size={16} className={alert ? "text-amber-600" : "text-primary"} />
      </div>
      <p className={cn("mt-3 font-serif text-3xl font-bold", alert && "text-amber-700")}>{value}</p>
    </div>
  );
}
