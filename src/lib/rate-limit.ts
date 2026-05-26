/**
 * Simple in-memory rate limiter for API routes.
 * Uses a sliding window per IP address.
 *
 * NOTE: This works per-process. In a multi-instance deployment (e.g. multiple
 * PM2 workers), each process has its own store. For production at scale,
 * consider Redis-backed rate limiting. For a single-VPS deployment this is
 * perfectly adequate.
 */

type Entry = { count: number; resetAt: number };

const stores = new Map<string, Map<string, Entry>>();

export interface RateLimitConfig {
  /** Unique identifier for this limiter (e.g. "auth-login") */
  id: string;
  /** Max requests allowed within the window */
  maxRequests: number;
  /** Window duration in seconds */
  windowSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Extract client IP from request headers.
 * Supports X-Forwarded-For (when behind nginx/proxy) and falls back.
 */
function getClientIP(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // Take the first IP (original client)
    return xff.split(",")[0].trim();
  }
  const realIP = req.headers.get("x-real-ip");
  if (realIP) return realIP.trim();
  // Fallback — won't happen behind a proxy but covers edge cases
  return "unknown";
}

/**
 * Check and consume a rate limit token.
 */
export function rateLimit(req: Request, config: RateLimitConfig): RateLimitResult {
  const { id, maxRequests, windowSec } = config;

  if (!stores.has(id)) {
    stores.set(id, new Map());
  }
  const store = stores.get(id)!;

  const ip = getClientIP(req);
  const now = Date.now();
  const entry = store.get(ip);

  // Cleanup expired entries periodically (every 100 checks)
  if (Math.random() < 0.01) {
    for (const [key, val] of store.entries()) {
      if (now > val.resetAt) store.delete(key);
    }
  }

  if (!entry || now > entry.resetAt) {
    // New window
    store.set(ip, { count: 1, resetAt: now + windowSec * 1000 });
    return { allowed: true, remaining: maxRequests - 1, retryAfterSec: 0 };
  }

  if (entry.count >= maxRequests) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  entry.count += 1;
  return { allowed: true, remaining: maxRequests - entry.count, retryAfterSec: 0 };
}

/**
 * Pre-configured rate limiter for login attempts.
 * 5 attempts per 60 seconds per IP.
 */
export const LOGIN_LIMIT: RateLimitConfig = {
  id: "auth-login",
  maxRequests: 5,
  windowSec: 60,
};

/**
 * Pre-configured rate limiter for registration.
 * 3 registrations per 60 seconds per IP.
 */
export const REGISTER_LIMIT: RateLimitConfig = {
  id: "auth-register",
  maxRequests: 3,
  windowSec: 60,
};
