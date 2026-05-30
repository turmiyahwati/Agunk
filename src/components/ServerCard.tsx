"use client";
import { memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Activity, Download, Upload, Gauge, Users, ArrowRight } from "lucide-react";
import { StatusBadge } from "./ui/StatusBadge";
import { ProgressBar } from "./ui/ProgressBar";
import { LivePing } from "./LivePing";
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
  /** Combined RX+TX Mbps (legacy v1.2 — kept for backward compatibility). */
  speedMbps: number;
  /** Download throughput in Mbps — realtime traffic flowing INTO the VPS. */
  rxSpeedMbps?: number;
  /** Upload throughput in Mbps — realtime traffic flowing OUT of the VPS. */
  txSpeedMbps?: number;
  rxBytes: number;
  txBytes: number;
  uptimeSec: number;
  cpuPercent?: number;
  ramPercent?: number;
  /**
   * Public-safe Cloudflare-Tunnel hostname for browser-side LivePing.
   * Operator sets this in admin → Servers. Optional — when absent the
   * card falls back to the server-reported pingMs.
   */
  pingHost?: string | null;
};

/**
 * Render a Mbps reading with sensible precision.
 *   < 1   → "0.x"
 *   < 10  → "X.Y"
 *   >= 10 → "NN"
 */
function fmtMbps(mbps: number | null | undefined): string {
  if (mbps == null || !isFinite(mbps) || mbps <= 0) return "0";
  if (mbps < 10) return mbps.toFixed(1);
  return Math.round(mbps).toString();
}

function ServerCardImpl({ server, href }: { server: ServerSummary; href?: string }) {
  const pct = slotPercent(server.activeUsers, server.maxSlot);
  const rx = server.rxSpeedMbps ?? 0;
  const tx = server.txSpeedMbps ?? 0;
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

      {/*
        Live ping (browser-side, updates every 2.5 s) + uptime. The ping is
        measured from the visitor's browser via the Cloudflare Tunnel
        hostname, so the displayed number reflects edge-to-server latency
        (NOT the direct visitor-to-VPS ping for a future VPN connection).
      */}
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2">
          <div className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">
            Ping (live)
          </div>
          <div className="text-sm">
            <LivePing host={server.pingHost} fallback={server.pingMs} />
          </div>
          <div className="mt-0.5 text-[9px] text-slate-600">via Cloudflare edge</div>
        </div>
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2">
          <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
            <Gauge size={11} /> Uptime
          </div>
          <div className="text-sm font-mono text-slate-100">{formatUptime(server.uptimeSec)}</div>
        </div>
      </div>

      {/*
        Realtime network throughput, split per direction. These are TRUE
        bytes-per-second readings from the VPS network counter — not a
        periodic speedtest. An idle server reports ~0; a busy server
        reports the current data rate. Same number you'd see in the
        Premium auto-installer's main menu SPEED line.
      */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-cyan-400/15 bg-cyan-400/5 p-2">
          <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-cyan-300/80">
            <Download size={11} /> Download
          </div>
          <div className="font-mono text-sm text-slate-100">{fmtMbps(rx)} Mbps</div>
        </div>
        <div className="rounded-lg border border-fuchsia-400/15 bg-fuchsia-400/5 p-2">
          <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-fuchsia-300/80">
            <Upload size={11} /> Upload
          </div>
          <div className="font-mono text-sm text-slate-100">{fmtMbps(tx)} Mbps</div>
        </div>
        <div className="col-span-2 -mt-1 inline-flex items-center gap-1 text-[9px] text-slate-600">
          <Activity size={9} /> Realtime traffic dari VPS
        </div>
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
