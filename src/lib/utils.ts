import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge CSS classes with Tailwind CSS specificity handling.
 * Combines clsx + tailwind-merge for proper class deduplication.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Calculate slot usage as percentage (active/max * 100).
 * Returns percentage value clamped between 0-100.
 */
export function slotPercent(active: number, max: number): number {
  if (max <= 0 || !isFinite(active) || !isFinite(max)) return 0;
  return Math.min(100, Math.round((active / max) * 100));
}

/**
 * Get country flag emoji based on country code.
 * Returns flag emoji or fallback image URL if emoji not available.
 */
export function flagUrl(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return "🌍";
  
  // Convert country code to flag emoji
  // e.g., "ID" → "🇮🇩", "US" → "🇺🇸"
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  
  return String.fromCodePoint(...codePoints);
}

/**
 * Format tested speedtest result with units.
 * Examples: 238.5 → "238.5 Mbps", null → "—"
 */
export function formatTestedSpeed(
  mbps: number | null | undefined,
  decimals = 1
): string {
  if (mbps == null || !isFinite(mbps)) return "—";
  return `${mbps.toFixed(decimals)} Mbps`;
}

/**
 * Format relative age (time ago) from a date.
 * Examples: now → "just now", 5 mins ago → "5m ago", 2 hours ago → "2h ago"
 */
export function formatRelativeAge(date: Date | string | null): string {
  if (!date) return "—";
  
  const now = Date.now();
  const past = new Date(date).getTime();
  const msAgo = now - past;
  
  if (isNaN(msAgo) || msAgo < 0) return "—";
  
  const seconds = Math.floor(msAgo / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  // For older dates, show relative to midnight
  return "—";
}

/**
 * Alias for formatRelativeAge (backward compatibility).
 * Format time ago from a date.
 */
export function timeAgo(date: Date | string | null): string {
  return formatRelativeAge(date);
}

/**
 * Determine if polling should be active based on page visibility.
 * Returns true if document is visible (tab active), false if hidden.
 * Used to pause API polling when user is not viewing the page.
 */
export function shouldPoll(): boolean {
  // In browser environment: check if tab is visible
  if (typeof document !== "undefined") {
    return !document.hidden;
  }
  // In non-browser (SSR): always poll
  return true;
}

/**
 * Format seconds into human-readable uptime string.
 * Examples:
 *   3661 seconds → "1h 1m"
 *   120 seconds → "2m"
 *   60 seconds → "1m"
 */
export function formatUptime(seconds: number): string {
  if (typeof seconds !== "number" || seconds < 0 || !isFinite(seconds)) {
    return "—";
  }

  const s = Math.floor(seconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return minutes > 0 ? `${minutes}m` : "0m";
}

/**
 * Convert bytes to human-readable format (GB, MB, KB, B).
 * Automatically selects appropriate unit based on magnitude.
 */
export function formatBytes(bytes: number | bigint, decimals = 2): string {
  if (typeof bytes === "bigint") {
    bytes = Number(bytes);
  }

  if (typeof bytes !== "number" || bytes < 0 || !isFinite(bytes)) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}

/**
 * Safe BigInt to Number conversion with overflow protection.
 * Returns the number, or a fallback value if conversion would overflow.
 */
export function safeBigIntToNumber(value: bigint | number, fallback = 0): number {
  if (typeof value === "number") return value;
  if (typeof value !== "bigint") return fallback;

  const num = Number(value);
  // Check if conversion lost precision (overflow)
  if (!isFinite(num) || num < 0) return fallback;
  return num;
}

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Calculate percentage display with bounds checking.
 * Returns value between 0-100, or the fallback if invalid.
 */
export function percentOrFallback(value: number, fallback = 0): number {
  const num = Number(value);
  if (!isFinite(num)) return fallback;
  return clamp(num, 0, 100);
}

/**
 * Normalize URL: add http:// if missing, remove trailing slash.
 */
export function normalizeApiUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}
