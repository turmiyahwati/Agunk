"use client";
import { memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Activity, Download, Upload, Network, Gauge, Users, ArrowRight } from "lucide-react";
import { StatusBadge } from "./ui/StatusBadge";
import { ProgressBar } from "./ui/ProgressBar";
import { LivePing } from "./LivePing";
import {
  flagUrl,
  slotPercent,
  formatBytes,
  formatUptime,
  formatLinkSpeed,
  formatTestedSpeed,
  formatRelativeAge,
} from "@/lib/utils";

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
  /** NIC port capacity in Mbps (e.g. 1000 = 1 Gbps). 0 = unknown. */
  linkSpeedMbps?: number;
  /** Latest periodic Ookla speedtest result. 0 = never tested. */
  lastSpeedtestDownMbps?: number;
  lastSpeedtestUpMbps?: number;
  lastSpeedtestPingMs?: number;
  /** ISO timestamp of the last successful speedtest (or null). */
  lastSpeedtestAt?: string | null;
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
 * Live-throughput formatter for the bottom-tier RX/TX block.
 *   < 1   → "0.x"
 *   < 10  → "X.Y"
 *   >= 10 → "NN"
 */
function fmtLiveMbps(mbps: number | null | undefined): string {
  if (mbps == null || !isFinite(mbps) || mbps <= 0) return "0";
  if (mbps < 10) return mbps.toFixed(1);
  return Math.round(mbps).toString();
}

function ServerCardImpl({ server, href }: { server: ServerSummary; href?: string }) {
  const pct = slotPercent(server.activeUsers, server.maxSlot);
  const rx = server.rxSpeedMbps ?? 0;
  const tx = server.txSpeedMbps ?? 0;
  const testedDown = server.lastSpeedtestDownMbps ?? 0;
  const testedUp = server.lastSpeedtestUpMbps ?? 0;
  const hasTested = testedDown > 0 || testedUp > 0;
  const portLabel = formatLinkSpeed(server.linkSpeedMbps);
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
        ── 3-Tier Network Performance ────────────────────────────────────
        Tier 1: Port Capacity   (NIC link speed, kernel — e.g. "1 Gbps")
        Tier 2: Tested Speed    (daily Ookla benchmark — e.g. "845/812 Mbps · 6h lalu")
        Tier 3: Live Traffic    (RX/TX realtime — current load)

        Each tier answers a different visitor question honestly: how big
        is the pipe, what's the real-world max, and how busy is it now.
        Labeled clearly so a non-technical buyer never confuses a tested
        capacity number with their own expected VPN speed.
      */}
      <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
          <Network size={11} /> Network Performance
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-400">Port</span>
            <span className="font-mono text-slate-200">{portLabel}</span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-400">Tested</span>
            {hasTested ? (
              <span className="font-mono text-slate-200">
                {formatTestedSpeed(testedDown)}
                <span className="text-slate-500"> / </span>
                {formatTestedSpeed(testedUp)}
                <span className="text-[10px] text-slate-500"> Mbps</span>
                <span className="ml-1 text-[10px] text-slate-500">
                  · {formatRelativeAge(server.lastSpeedtestAt)}
                </span>
              </span>
            ) : (
              <span className="text-[11px] italic text-slate-500">Belum diuji</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-1.5">
            <span className="inline-flex items-center gap-1 text-slate-400">
              <Activity size={10} className="text-cyan-300" />
              Live
            </span>
            <span className="font-mono text-slate-200">
              <Download size={10} className="mb-0.5 mr-0.5 inline text-cyan-300/80" />
              {fmtLiveMbps(rx)}
              <span className="mx-1 text-slate-500"></span>
              <Upload size={10} className="mb-0.5 mr-0.5 inline text-fuchsia-300/80" />
              {fmtLiveMbps(tx)}
              <span className="text-[10px] text-slate-500"> Mbps</span>
            </span>
          </div>
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
