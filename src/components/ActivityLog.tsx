"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Activity as ActivityIcon, Power, AlertTriangle } from "lucide-react";
import { shouldPoll, timeAgo } from "@/lib/utils";

const REFRESH_MS = Number(process.env.NEXT_PUBLIC_REFRESH_MS || 10000);
// Activity feed polls a separate (faster) cadence than server cards.
// CREATE / status events are inherently more time-sensitive than card
// metrics — visitors expect them to appear within a few seconds. Default
// is half the card cadence (5 s); operators can tune via env without
// touching the code.
const ACTIVITY_REFRESH_MS = Number(
  process.env.NEXT_PUBLIC_ACTIVITY_REFRESH_MS || 5000,
);

type ActivityKind = "STATUS" | "SSH" | "VMESS" | "VLESS" | "TROJAN";

type Activity = {
  id: string;
  /** Event kind. Internal status events use "STATUS"; external VPN-account
   *  events use the protocol slug. */
  kind: ActivityKind | string;
  serverName: string;
  /** For STATUS events: a transition string like "OFFLINE→ONLINE".
   *  For VPN events: typically "CREATE". */
  action: string;
  createdAt: string;
};

const PROTOCOL_TONE: Record<string, string> = {
  SSH:    "border-cyan-300/30 bg-cyan-300/10 text-cyan-200",
  VMESS:  "border-purple-400/30 bg-purple-400/10 text-purple-200",
  VLESS:  "border-emerald-300/30 bg-emerald-300/10 text-emerald-200",
  TROJAN: "border-rose-300/30 bg-rose-300/10 text-rose-200",
};

/**
 * Tone for STATUS-kind rows depends on the destination state we are
 * transitioning INTO. "OFFLINE" turns rose, "ONLINE" goes emerald,
 * "WARNING" goes amber, anything else is a neutral slate.
 */
function statusTone(action: string): string {
  const dest = action.split("→").pop()?.trim().toUpperCase() ?? "";
  if (dest === "OFFLINE") return "border-rose-400/30 bg-rose-400/10 text-rose-200";
  if (dest === "ONLINE")  return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (dest === "WARNING") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (dest === "FULL")    return "border-fuchsia-300/30 bg-fuchsia-300/10 text-fuchsia-200";
  return "border-slate-400/20 bg-slate-400/10 text-slate-200";
}

/**
 * Pick an icon for STATUS rows based on the destination state. Other
 * kinds (SSH/VMESS/...) just get the slug rendered as a chip.
 */
function StatusIcon({ action }: { action: string }) {
  const dest = action.split("→").pop()?.trim().toUpperCase() ?? "";
  if (dest === "OFFLINE") return <Power size={11} />;
  if (dest === "ONLINE")  return <ActivityIcon size={11} />;
  if (dest === "WARNING" || dest === "FULL") return <AlertTriangle size={11} />;
  return <ActivityIcon size={11} />;
}

/**
 * Friendlier human-readable label for a STATUS transition. We turn
 * "OFFLINE→ONLINE" into "back online", "ONLINE→OFFLINE" into "went
 * offline", etc., so the feed reads as sentences instead of arrows.
 */
function statusLabel(action: string): string {
  const parts = action.split("→").map((p) => p.trim().toUpperCase());
  const from = parts[0] ?? "";
  const to = parts[1] ?? parts[0] ?? "";
  if (to === "ONLINE")  return from === "OFFLINE" ? "back online" : "online";
  if (to === "OFFLINE") return "went offline";
  if (to === "WARNING") return "near full slot";
  if (to === "FULL")    return "slot full";
  if (to === "UNKNOWN") return "unreachable";
  return to.toLowerCase() || action;
}

/**
 * Realtime feed of server-side activity events.
 *
 * Polls /api/activity every REFRESH_MS while the tab is visible. The
 * data behind the feed is REAL — every row is either a status
 * transition emitted by the monitor sync layer (`lib/monitor.ts →
 * syncServer`) or an external VPN-account event POST'd by the
 * operator's order system. There are no synthetic / demo rows.
 *
 * Bumping the optional `refreshNonce` prop forces an immediate refetch
 * (used by the public "Refresh Server" button).
 */
export function ActivityLog({ refreshNonce = 0 }: { refreshNonce?: number } = {}) {
  const [items, setItems] = useState<Activity[] | null>(null);
  const [, forceTick] = useState(0);
  const inflightRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    inflightRef.current?.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    try {
      const res = await fetch("/api/activity?limit=12", {
        cache: "no-store",
        signal: ctrl.signal,
      });
      const j = await res.json();
      if (ctrl.signal.aborted) return;
      setItems(j.activities ?? []);
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      setItems([]);
    } finally {
      if (inflightRef.current === ctrl) inflightRef.current = null;
    }
  }, []);

  useEffect(() => {
    fetchOnce();
    const t = setInterval(() => {
      if (shouldPoll()) fetchOnce();
    }, ACTIVITY_REFRESH_MS);
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
      inflightRef.current?.abort();
      inflightRef.current = null;
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
          Belum ada aktivitas terbaru. Status transitions from monitored
          servers akan muncul di sini secara otomatis.
        </div>
      ) : (
        <ul className="relative max-h-72 space-y-1.5 overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {items.map((a) => {
              const isStatus = a.kind === "STATUS";
              const tone = isStatus ? statusTone(a.action) : (PROTOCOL_TONE[a.kind] ?? PROTOCOL_TONE.SSH);
              return (
                <motion.li
                  key={a.id}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm hover:bg-white/[0.04]"
                >
                  {isStatus ? (
                    <>
                      <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wider ${tone}`}>
                        <StatusIcon action={a.action} />
                        STATUS
                      </span>
                      <span className="truncate text-slate-200">{a.serverName}</span>
                      <span className="truncate text-[12px] text-slate-400">
                        {statusLabel(a.action)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                        {a.action}
                      </span>
                      <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wider ${tone}`}>
                        {a.kind}
                      </span>
                      <span className="truncate text-slate-200">{a.serverName}</span>
                    </>
                  )}
                  <span className="ml-auto whitespace-nowrap text-[11px] text-slate-500">
                    {timeAgo(a.createdAt)}
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
