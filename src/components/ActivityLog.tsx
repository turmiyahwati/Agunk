"use client";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import { shouldPoll, timeAgo } from "@/lib/utils";

const REFRESH_MS = Number(process.env.NEXT_PUBLIC_REFRESH_MS || 10000);

type Activity = {
  id: string;
  protocol: "SSH" | "VMESS" | "VLESS" | "TROJAN";
  serverName: string;
  action: string;
  createdAt: string;
};

const PROTOCOL_TONE: Record<Activity["protocol"], string> = {
  SSH:    "border-cyan-300/30 bg-cyan-300/10 text-cyan-200",
  VMESS:  "border-purple-400/30 bg-purple-400/10 text-purple-200",
  VLESS:  "border-emerald-300/30 bg-emerald-300/10 text-emerald-200",
  TROJAN: "border-rose-300/30 bg-rose-300/10 text-rose-200",
};

/**
 * Realtime feed of VPN account creation events.
 *
 * - Polls /api/activity every REFRESH_MS only while the tab is visible
 *   (saves bandwidth and mobile battery).
 * - Refetches immediately on visibility change so the feed feels fresh
 *   when the user comes back.
 * - Bumping the optional `refreshNonce` prop forces an immediate refetch
 *   (used by the public "Refresh Server" button).
 */
export function ActivityLog({ refreshNonce = 0 }: { refreshNonce?: number } = {}) {
  const [items, setItems] = useState<Activity[] | null>(null);
  const [, forceTick] = useState(0);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?limit=12", { cache: "no-store" });
      const j = await res.json();
      setItems(j.activities ?? []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    fetchOnce();
    const t = setInterval(() => {
      if (shouldPoll()) fetchOnce();
    }, REFRESH_MS);
    const onVis = () => {
      if (typeof document !== "undefined" && !document.hidden) fetchOnce();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }
    return () => {
      clearInterval(t);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
    };
  }, [fetchOnce]);

  // External refresh trigger from the public page's "Refresh Server" button.
  useEffect(() => {
    if (refreshNonce > 0) fetchOnce();
  }, [refreshNonce, fetchOnce]);

  // Re-render every 30s so "X menit lalu" labels stay fresh between polls.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="glass relative overflow-hidden p-5 md:p-6">
      <div className="pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full bg-gradient-to-br from-cyan-400/15 to-purple-500/10 blur-3xl" />

      <div className="relative mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-cyan-300" />
          <h2 className="text-base font-semibold tracking-tight md:text-lg">
            Realtime <span className="neon-text">Activity</span>
          </h2>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-200">
          <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-emerald-400" />
          Live
        </div>
      </div>

      {items === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 w-full animate-pulse rounded-lg bg-white/[0.04]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-6 text-center text-xs text-slate-500">
          Belum ada aktivitas terbaru.
        </div>
      ) : (
        <ul className="relative max-h-72 space-y-1.5 overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {items.map((a) => (
              <motion.li
                key={a.id}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm hover:bg-white/[0.04]"
              >
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                  {a.action}
                </span>
                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wider ${PROTOCOL_TONE[a.protocol] ?? ""}`}>
                  {a.protocol}
                </span>
                <span className="truncate text-slate-200">{a.serverName}</span>
                <span className="ml-auto whitespace-nowrap text-[11px] text-slate-500">
                  {timeAgo(a.createdAt)}
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
