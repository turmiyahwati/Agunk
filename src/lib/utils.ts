/**
 * Format seconds into human-readable uptime string.
 * Examples:
 *   3661 seconds → "1h 1m"
 *   120 seconds → "2m"
 *   60 seconds → "1m"
 */
export function formatUptime(seconds: number): string {
  if (typeof seconds !== 'number' || seconds < 0 || !isFinite(seconds)) {
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
  if (typeof bytes === 'bigint') {
    bytes = Number(bytes);
  }
  
  if (typeof bytes !== 'number' || bytes < 0 || !isFinite(bytes)) {
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
  if (typeof value === 'number') return value;
  if (typeof value !== 'bigint') return fallback;
  
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
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}
