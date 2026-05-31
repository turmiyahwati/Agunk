"use client";
import { memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  Activity,
  Cpu,
  Download,
  Gauge,
  MemoryStick,
  Network,
  Upload,
  Users,
  ArrowRight,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { StatusBadge } from "./ui/StatusBadge";
import { ProgressBar } from "./ui/ProgressBar";
import { AnimatedNumber } from "./ui/AnimatedNumber";
import {
  flagUrl,
  slotPercent,
  formatBytes,
  formatUptime,
  formatTestedSpeed,
  formatRelativeAge,
} from "@/lib/utils";
import { useMetricBuffer, type SparkPoint } from "@/hooks/useMetricBuffer";

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
  /**
   * Subscriber count (registered accounts not yet expired). Drives the
   * Slot tile and WARNING/FULL thresholds. Sourced from the agent's
   * `active_users` payload field.
   */
  activeUsers: number;
  /**
   * Live login count (currently-connected sessions across SSH + Xray).
   * Distinct from `activeUsers` above. Drives the "Users" line on the
   * server detail chart so visitors see real-time usage rather than
   * subscription totals. Optional for backward compat with pre-v1.7
   * agents that didn't emit it — older agents leave it at 0.
   */
  activeLogins?: number;
  /** Combined RX+TX Mbps (legacy v1.2 — kept for backward compatibility). */
  speedMbps: number;
  /** Download throughput in Mbps — realtime traffic flowing INTO the VPS. */
  rxSpeedMbps?: number;
  /** Upload throughput in Mbps — realtime traffic flowing OUT of the VPS. */
  txSpeedMbps?: number;
  /** Latest periodic Ookla speedtest result. 0 = never tested. */
  lastSpeedtestDownMbps?: number;
  lastSpeedtestUpMbps?: number;
  lastSpeedtestPingMs?: number;
  /** ISO timestamp of the last successful speedtest (or null). */
  lastSpeedtestAt?: string | null;
  /** Cumulative bytes for the current calendar month (vnstat). */
  rxBytes: number;
  txBytes: number;
  /** Today's bytes (vnstat daily bucket). 0 = no daily data yet. */
  rxBytesToday?: number;
  txBytesToday?: number;
  /** Since-reboot bytes (psutil counter). Resets on each VPS reboot. */
  rxBytesBoot?: number;
  txBytesBoot?: number;
  uptimeSec: number;
  cpuPercent?: number;
  ramPercent?: number;
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

/**
 * Compact sparkline area chart for CPU / RAM tiles. Renders nothing
 * until enough samples are collected to make a curve worth looking at
 * — a single dot is visual noise, two points form the first segment.
 */
function MiniSparkline({
  data,
  color,
  fillId,
}: {
  data: SparkPoint[];
  color: string;
  fillId: string;
}) {
  if (data.length < 2) return <div className="h-8" />;
  return (
    <div className="h-8 -mx-1 -mb-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${fillId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ServerCardImpl({ server, href }: { server: ServerSummary; href?: string }) {
  const pct = slotPercent(server.activeUsers, server.maxSlot);
  const rx = server.rxSpeedMbps ?? 0;
  const tx = server.txSpeedMbps ?? 0;
  const testedDown = server.lastSpeedtestDownMbps ?? 0;
  const testedUp = server.lastSpeedtestUpMbps ?? 0;
  const hasTested = testedDown > 0 || testedUp > 0;

  // Rolling sparklines for the CPU / RAM tiles. The buffer is
  // populated by the parent's polling loop — every fresh
  // /api/servers/public response feeds a new sample in.
  const cpuHistory = useMetricBuffer(server.cpuPercent, 30);
  const ramHistory = useMetricBuffer(server.ramPercent, 30);

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
        Uptime tile. The previous "Ping (live)" tile was removed because
        the dashboard now reports only metrics it can actually verify
        end-to-end — operator-side ICMP/TCP ping numbers were neither
        useful for the visitor (it measured network reachability from
        the agent's PoV, not theirs) nor reliable across providers that
        block ICMP on the gateway.
      */}
      <div className="mt-4 grid grid-cols-1 gap-3 text-xs">
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2">
          <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
            <Gauge size={11} /> Uptime
          </div>
          <div className="text-sm font-mono text-slate-100">{formatUptime(server.uptimeSec)}</div>
        </div>
      </div>

      {/*
        CPU / RAM tiles with rolling sparkline. The numbers are the
        same realtime values the agent emits via /api/status, but the
        sparkline retains the recent history client-side so visitors
        SEE the load fluctuate instead of just a single static
        percentage. No fake data — every point on the curve is one
        polling response from the agent.
      */}
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg border border-cyan-400/15 bg-cyan-400/5 p-2">
          <div className="mb-0.5 flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-cyan-300/80">
              <Cpu size={11} /> CPU
            </span>
            <span className="font-mono text-sm text-slate-100">
              {Math.round(server.cpuPercent ?? 0)}%
            </span>
          </div>
          <MiniSparkline data={cpuHistory} color="#22d3ee" fillId={`cpu-${server.id}`} />
        </div>
        <div className="rounded-lg border border-fuchsia-400/15 bg-fuchsia-400/5 p-2">
          <div className="mb-0.5 flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-fuchsia-300/80">
              <MemoryStick size={11} /> RAM
            </span>
            <span className="font-mono text-sm text-slate-100">
              {Math.round(server.ramPercent ?? 0)}%
            </span>
          </div>
          <MiniSparkline data={ramHistory} color="#a855f7" fillId={`ram-${server.id}`} />
        </div>
      </div>

      {/*
        ── 2-Tier Network Performance ────────────────────────────────────
        Tier 1: Tested Speed    (daily Ookla benchmark)
        Tier 2: Live Traffic    (RX/TX realtime — current load)

        The previous "Port Capacity" tier was removed because the
        kernel-reported NIC link speed was unreliable in containerized
        / virtualized deployments (LXC/Docker veth interfaces report 0
        or 10 Mbps regardless of actual provider capacity) and was
        misleading visitors more than it was informing them.
      */}
      <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
          <Network size={11} /> Network Performance
        </div>

        <div className="space-y-1.5 text-xs">
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
          <span className="font-mono text-slate-300">
            <AnimatedNumber value={server.activeUsers} />
            /{server.maxSlot} (<AnimatedNumber value={pct} />%)
          </span>
        </div>
        <ProgressBar value={pct} />
      </div>

      {/*
        ── Traffic counters: TODAY (prominent) + Since reboot ────────────
        TODAY is the daily-billing-relevant number from vnstat. Since
        Reboot mirrors the "RX / TX" line in the Premium installer
        panel — both are public so any visitor can verify the figures.
      */}
      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/5 pt-3 text-[11px]">
        <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-2">
          <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300">
            TODAY
          </div>
          <div className="font-mono text-slate-100">
            <Download size={10} className="mb-0.5 mr-0.5 inline text-cyan-300/80" />
            {formatBytes(server.rxBytesToday ?? 0)}
            <span className="mx-1 text-slate-600">·</span>
            <Upload size={10} className="mb-0.5 mr-0.5 inline text-fuchsia-300/80" />
            {formatBytes(server.txBytesToday ?? 0)}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
          <div className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">
            Sejak reboot
          </div>
          <div className="font-mono text-slate-200">
            <Download size={10} className="mb-0.5 mr-0.5 inline text-cyan-300/80" />
            {formatBytes(server.rxBytesBoot ?? 0)}
            <span className="mx-1 text-slate-600">·</span>
            <Upload size={10} className="mb-0.5 mr-0.5 inline text-fuchsia-300/80" />
            {formatBytes(server.txBytesBoot ?? 0)}
          </div>
        </div>
      </div>

      {href && (
        <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
          <span>Bulan ini: ↓ {formatBytes(server.rxBytes)} · ↑ {formatBytes(server.txBytes)}</span>
          <Link href={href} className="inline-flex items-center gap-1 text-cyan-300 hover:underline">
            Detail <ArrowRight size={12} />
          </Link>
        </div>
      )}
    </motion.div>
  );
}

/**
 * Memoized so the public homepage doesn't re-render every card when only
 * the stats counter changes. Server objects are referentially stable
 * across polls (the parent uses `useMemo` on `filtered`).
 */
export const ServerCard = memo(ServerCardImpl);
