/**
 * Security sanitization utilities for member-facing API responses.
 * Ensures no internal IPs, credentials, or sensitive data leak to the frontend.
 */

// RFC 1918 private IP ranges + loopback + link-local
const PRIVATE_IP_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,            // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12
  /^192\.168\.\d{1,3}\.\d{1,3}$/,                // 192.168.0.0/16
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,            // 127.0.0.0/8
  /^169\.254\.\d{1,3}\.\d{1,3}$/,                // link-local
  /^0\.0\.0\.0$/,                                 // unspecified
  /^fc[0-9a-f]{2}:/i,                            // IPv6 ULA fc00::/7
  /^fd[0-9a-f]{2}:/i,                            // IPv6 ULA
  /^fe80:/i,                                      // IPv6 link-local
  /^::1$/,                                        // IPv6 loopback
];

/**
 * Returns true if the given string looks like a private/internal IP address.
 */
export function isPrivateIP(value: string): boolean {
  const trimmed = value.trim();
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Sanitizes a domain/IP field for member-facing display.
 * - If it's a domain name (contains dots and letters), return as-is (public endpoint).
 * - If it's a public IP, return as-is.
 * - If it's a private/internal IP, mask it.
 * - Strip any port numbers from display (":8787" etc.) to avoid exposing agent ports.
 */
export function sanitizeDomain(domain: string | null | undefined): string {
  if (!domain) return "—";

  // Remove port suffix if present (e.g. "1.2.3.4:8787" → "1.2.3.4")
  const withoutPort = domain.replace(/:\d+$/, "").trim();

  if (!withoutPort) return "—";

  // Check if it's a private IP → mask it
  if (isPrivateIP(withoutPort)) {
    return "*.*.internal";
  }

  // If it looks like a pure IP (all digits and dots), check if it's valid public IP
  const isIPv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(withoutPort);
  if (isIPv4) {
    // It's a public IP - return it (member needs it for server selection)
    return withoutPort;
  }

  // It's a domain name - return without port (safe for member display)
  return withoutPort;
}

/**
 * List of fields that must NEVER be sent to member/public-facing responses.
 * Used as a reference; actual protection is via Prisma `select` + explicit sanitization.
 */
export const SENSITIVE_FIELDS = [
  "apiUrl",
  "apiKey",
  "lastError",  // may contain internal connection strings or IPs
  "password",
  "refreshMs",  // internal config
] as const;
