import Link from "next/link";

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const cls = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-xl";
  return (
    <Link href="/" className="inline-flex items-center gap-2">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-purple-600 shadow-glow-sm">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-black" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 18 L12 4 L19 18" />
          <path d="M8 14 H16" />
        </svg>
      </div>
      <span className={`font-bold tracking-tight ${cls}`}>
        <span className="neon-text">PT SONTOLOYO</span>
        <span className="text-slate-400 mx-1">·</span>
        <span className="text-slate-300">Monitor</span>
      </span>
    </Link>
  );
}
