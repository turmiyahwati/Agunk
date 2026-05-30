"use client";
import { memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Gauge, Users, ArrowRight } from "lucide-react";
import { StatusBadge } from "./ui/StatusBadge";
import { ProgressBar } from "./ui/ProgressBar";
import { LivePing } from "./LivePing";
import { LiveSpeed } from "./LiveSpeed";
import { flagUrl, slotPercent, formatBytes, formatUptime } from "@/lib/utils";

export type ServerSummary = {
  id: string;
  name: string;
  /**
   * Hostname / IP / panel URL of the server. The PUBLIC `/api/servers/public`
   * endpoint returns this as an empty string for security — only the
   * authenticated admin API exposes the real value.
   */
  domain: string;
  country: string;
  countryName: string;
  flag?: string | null;
  provider: string;
  maxSlot: number;
  status: "ONLINE" | "OFFLINE" | "FULL" | "WARNING" | "UNKNOWN";
  activeUsers: number;
  pingMs: number;
  speedMbps: number;
  rxBytes: number;
  txBytes: number;
  uptimeSec: number;
  cpuPercent?: number;
  ramPercent?: number;
  /**
   * Public-safe Cloudflare-Tunnel hostname for browser-side LivePing /
   * LiveSpeed. Operator sets this in admin → Servers. Optional — when
   * absent the card falls back to server-reported numbers.
   */
  pingHost?: string | null;
};

function ServerCardImpl({ server, href }: { server: ServerSummary; href?: string }) {
  const pct = slotPercent(server.activeUsers, server.maxSlot);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass glass-hover relative overflow-hidden p-5"
    >
      <div className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-gradient-to-br from-cyan-400/20 to-purple-500/10 blur-2xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-14 overflow-hidden rounded-md ring-1 ring-white/10">
            <Image src={server.flag || flagUrl(server.country)} alt={server.country} fill sizes="56px" className="object-cover" />
          </div>
          <div>
            <div className="font-semibold tracking-tight">{server.name}</div>
            <div className="text-xs text-slate-400">{server.countryName} · {server.provider}</div>
          </div>
        </div>
        <StatusBadge status={server.status} />
      </div>

      {/* Live ping + uptime. The ping number updates every 2.5s straight from
          the visitor's browser when `pingHost` is configured — that's the
          "true realtime" gauge that customers can trust. */}
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2">
          <div className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">
            Ping (live)
          </div>
          <div className="text-sm">
            <LivePing host={server.pingHost} fallback={server.pingMs} />
          </div>
        </div>
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2">
          <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
            <Gauge size={11} /> Uptime
          </div>
          <div className="text-sm font-mono text-slate-100">{formatUptime(server.uptimeSec)}</div>
        </div>
      </div>

      {/* Speedtest measured live from the visitor's browser. Auto-runs
          once when this card scrolls into view; falls back gracefully
          when the browser blocks cross-origin probes. */}
      <div className="mt-3">
        <LiveSpeed host={server.pingHost} fallbackMbps={server.speedMbps} />
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-slate-400 inline-flex items-center gap-1.5">
            <Users size={13} /> Slot
          </span>
          <span className="font-mono text-slate-300">{server.activeUsers}/{server.maxSlot} ({pct}%)</span>
        </div>
        <ProgressBar value={pct} />
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3 text-[11px] text-slate-400">
        <div>RX <span className="text-slate-200">{formatBytes(server.rxBytes)}</span></div>
        <div>TX <span className="text-slate-200">{formatBytes(server.txBytes)}</span></div>
        {href && (
          <Link href={href} className="inline-flex items-center gap-1 text-cyan-300 hover:underline">
            Detail <ArrowRight size={12} />
          </Link>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Memoized so the public homepage doesn't re-render every card when only
 * the stats counter changes. Server objects are referentially stable
 * across polls (the parent uses `useMemo` on `filtered`).
 */
export const ServerCard = memo(ServerCardImpl);
