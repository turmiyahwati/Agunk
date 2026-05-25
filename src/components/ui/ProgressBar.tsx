import { cn } from "@/lib/utils";

export function ProgressBar({
  value,
  max = 100,
  className,
}: {
  value: number;
  max?: number;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const tone =
    pct >= 100 ? "from-rose-500 to-orange-500"
    : pct >= 90 ? "from-yellow-400 to-orange-500"
    : "from-cyan-400 to-purple-500";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-white/5", className)}>
      <div
        className={cn("h-full rounded-full bg-gradient-to-r shadow-[0_0_12px_rgba(34,211,238,0.55)] transition-all duration-500", tone)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
