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

export function deriveStatus(opts: {
  online: boolean;
  active: number;
  max: number;
}): "ONLINE" | "OFFLINE" | "FULL" | "WARNING" {
  if (!opts.online) return "OFFLINE";
  const pct = slotPercent(opts.active, opts.max);
  if (opts.max > 0 && opts.active >= opts.max) return "FULL";
  if (pct >= 90) return "WARNING";
  return "ONLINE";
}
