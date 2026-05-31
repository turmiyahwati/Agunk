import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number | bigint, decimals = 2): string {
  const n = typeof bytes === "bigint" ? Number(bytes) : bytes;
  if (!n || n <= 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(k)));
  return `${(n / Math.pow(k, i)).toFixed(decimals)} ${units[i]}`;
}

export function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function flagUrl(country: string): string {
  const code = (country || "un").toLowerCase();
  return `https://flagcdn.com/${code}.svg`;
}

export function slotPercent(active: number, max: number): number {
  if (!max) return 0;
  return Math.min(100, Math.round((active / max) * 100));
}

/**
 * Render a Mbps reading with sensible precision.
 *
 *   0           → "—"     (no traffic detected — render as a dash, not "0 Mb")
 *   0 < n < 10  → "X.Y Mb" (1 decimal — keeps sub-Mbps VPN traffic visible)
 *   n >= 10     → "N Mb"   (integer — large pipes don't need decimals)
 *
 * Pairs with the agent's float-typed `speed` field. The previous int
 * rendering ("X Mb" with a falsy-zero check) hid every traffic level
 * below 1 Mbps as "—", which made operators believe the dashboard was
 * broken when in fact a VPN with 0.4 Mbps avg traffic was working fine.
 */
export function formatSpeed(mbps: number | null | undefined, suffix = "Mb"): string {
  if (mbps == null || !isFinite(mbps) || mbps <= 0) return "—";
  if (mbps < 10) return `${mbps.toFixed(1)} ${suffix}`;
  return `${Math.round(mbps)} ${suffix}`;
}

/**
 * Format a Mbps reading from a periodic Ookla speedtest result.
 *
 * Distinct from `formatSpeed` which formats live throughput: for a
 * tested baseline, sub-Mbps precision adds noise rather than information
 * and large numbers are the headline. Returns "—" when no test has run
 * yet so the dashboard can show "Belum diuji" instead of a misleading
 * zero.
 *
 *   0          → "—"
 *   1..99      → "85"
 *   100+       → "845"
 */
export function formatTestedSpeed(mbps: number | null | undefined): string {
  if (mbps == null || !isFinite(mbps) || mbps <= 0) return "—";
  return Math.round(mbps).toString();
}

/**
 * Compact "time ago" caption for the speedtest freshness label.
 *
 * Shorter than the full Indonesian `timeAgo` which renders
 * "5 menit lalu" — the speedtest tier wants something that fits beside
 * a number on a small server card without wrapping.
 *
 *   null/invalid → "belum diuji"
 *   < 60s        → "barusan"
 *   < 60m        → "Xm lalu"
 *   < 24h        → "Xh lalu"
 *   else         → "Xd lalu"
 */
export function formatRelativeAge(input: Date | string | null | undefined): string {
  if (!input) return "belum diuji";
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return "belum diuji";
  const seconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return "barusan";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h lalu`;
  const days = Math.floor(hours / 24);
  return `${days}d lalu`;
}

/**
 * Indonesian relative-time formatter used by the activity log.
 *  < 5s  → "baru saja"
 *  < 60s → "X detik lalu"
 *  < 1h  → "X menit lalu"
 *  < 24h → "X jam lalu"
 *  else  → "X hari lalu"
 */
export function timeAgo(input: Date | string | number): string {
  const d = input instanceof Date ? input : new Date(input);
  const seconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (seconds < 5) return "baru saja";
  if (seconds < 60) return `${seconds} detik lalu`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}

/**
 * Polling guard: returns true when the page is currently visible (or when
 * running on the server / before hydration). Used to skip realtime fetches
 * while the user has the tab in the background — saves CPU, network, and
 * mobile battery without breaking the live feel (we refetch on visibility
 * change anyway).
 */
export function shouldPoll(): boolean {
  if (typeof document === "undefined") return true;
  return !document.hidden;
}
