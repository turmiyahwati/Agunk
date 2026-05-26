"use client";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./ui/AnimatedNumber";

type Tone = "cyan" | "purple" | "emerald" | "rose" | "yellow";

const tones: Record<Tone, string> = {
  cyan:    "from-cyan-400/20 to-cyan-400/0 text-cyan-300",
  purple:  "from-purple-500/20 to-purple-500/0 text-purple-300",
  emerald: "from-emerald-400/20 to-emerald-400/0 text-emerald-300",
  rose:    "from-rose-400/20 to-rose-400/0 text-rose-300",
  yellow:  "from-yellow-400/20 to-yellow-400/0 text-yellow-300",
};

/**
 * StatCard with animated numeric counter. If `value` is a number it animates
 * smoothly via AnimatedNumber; if it's a ReactNode it renders as-is.
 * `live` adds a subtle pulse-glow on the icon to convey realtime feel.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "cyan",
  live = false,
}: {
  icon: React.ComponentType<any>;
  label: string;
  value: React.ReactNode | number;
  sub?: React.ReactNode;
  tone?: Tone;
  live?: boolean;
}) {
  const isNumber = typeof value === "number";
  return (
    <div className="glass relative overflow-hidden p-5">
      <div className={cn("absolute inset-x-0 top-0 h-px bg-gradient-to-r", tones[tone])} />
      {live && (
        <div className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-gradient-to-br from-cyan-400/20 via-purple-500/10 to-transparent blur-2xl animate-pulse-glow" />
      )}
      <div className="relative flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
          <div className="mt-1 text-2xl font-bold text-white">
            {isNumber ? <AnimatedNumber value={value as number} /> : value}
          </div>
          {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
        </div>
        <div className={cn(
          "grid h-10 w-10 place-items-center rounded-xl bg-white/[0.04] ring-1 ring-white/10",
          tones[tone],
          live && "animate-pulse-glow",
        )}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}
