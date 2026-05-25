import { cn } from "@/lib/utils";

type Status = "ONLINE" | "OFFLINE" | "FULL" | "WARNING" | "UNKNOWN";

const map: Record<Status, { label: string; cls: string; dot: string }> = {
  ONLINE:  { label: "ONLINE",    cls: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300", dot: "bg-emerald-400 shadow-[0_0_10px_#34d399]" },
  OFFLINE: { label: "OFFLINE",   cls: "border-rose-400/30 bg-rose-400/10 text-rose-300",         dot: "bg-rose-400 shadow-[0_0_10px_#fb7185]" },
  FULL:    { label: "FULL SLOT", cls: "border-orange-400/30 bg-orange-400/10 text-orange-300",   dot: "bg-orange-400 shadow-[0_0_10px_#fb923c]" },
  WARNING: { label: "WARNING",   cls: "border-yellow-400/30 bg-yellow-400/10 text-yellow-300",   dot: "bg-yellow-400 shadow-[0_0_10px_#facc15]" },
  UNKNOWN: { label: "UNKNOWN",   cls: "border-slate-400/30 bg-slate-400/10 text-slate-300",      dot: "bg-slate-400" },
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const m = map[status] ?? map.UNKNOWN;
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wider", m.cls, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full animate-pulse-glow", m.dot)} />
      {m.label}
    </span>
  );
}
