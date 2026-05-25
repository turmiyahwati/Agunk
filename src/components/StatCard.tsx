import { cn } from "@/lib/utils";

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "cyan",
}: {
  icon: React.ComponentType<any>;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "cyan" | "purple" | "emerald" | "rose" | "yellow";
}) {
  const tones: Record<string, string> = {
    cyan:    "from-cyan-400/20 to-cyan-400/0 text-cyan-300",
    purple:  "from-purple-500/20 to-purple-500/0 text-purple-300",
    emerald: "from-emerald-400/20 to-emerald-400/0 text-emerald-300",
    rose:    "from-rose-400/20 to-rose-400/0 text-rose-300",
    yellow:  "from-yellow-400/20 to-yellow-400/0 text-yellow-300",
  };
  return (
    <div className="glass relative overflow-hidden p-5">
      <div className={cn("absolute inset-x-0 top-0 h-px bg-gradient-to-r", tones[tone])} />
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
          <div className="mt-1 text-2xl font-bold text-white">{value}</div>
          {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
        </div>
        <div className={cn("grid h-10 w-10 place-items-center rounded-xl bg-white/[0.04] ring-1 ring-white/10", tones[tone])}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}
