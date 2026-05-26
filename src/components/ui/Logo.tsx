"use client";
import Link from "next/link";
import { useBranding } from "@/hooks/useBranding";

const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || "PT Sontoloyo";
const SUBBRAND = process.env.NEXT_PUBLIC_BRAND_SUFFIX || "Monitor";

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const cls = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-xl";
  const { logo } = useBranding();

  return (
    <Link href="/" className="inline-flex items-center gap-2">
      <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-cyan-400 to-purple-600 shadow-glow-sm">
        {logo ? (
          // Custom uploaded logo. Using <img> (not next/image) so the URL change
          // (timestamped after each upload) busts the cache without rerouting
          // through Next.js image optimization.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="Logo" className="h-full w-full object-cover" />
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-black" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 18 L12 4 L19 18" />
            <path d="M8 14 H16" />
          </svg>
        )}
      </div>
      <span className={`font-bold tracking-tight ${cls}`}>
        <span className="neon-text">{BRAND}</span>
        <span className="text-slate-400"> · </span>
        <span className="text-slate-300">{SUBBRAND}</span>
      </span>
    </Link>
  );
}
