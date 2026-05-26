/**
 * Safe error response helper.
 * Ensures no internal stack traces, Prisma model names, or connection
 * strings are ever leaked to the client.
 */

import { ZodError } from "zod";

/**
 * Extract a client-safe error message from a caught exception.
 * - Zod errors → first human-readable validation message
 * - Known Prisma codes → generic user-facing messages
 * - Everything else → "Something went wrong"
 */
export function safeErrorMessage(e: unknown): string {
  if (e instanceof ZodError) {
    const first = e.errors[0];
    if (first) {
      const path = first.path.length > 0 ? `${first.path.join(".")}: ` : "";
      return `${path}${first.message}`;
    }
    return "Validation failed";
  }

  if (isObject(e)) {
    // Prisma known error codes
    const code = (e as any).code;
    if (code === "P2002") return "A record with that value already exists";
    if (code === "P2025") return "Record not found";
    if (code === "P2003") return "Related record not found";

    // Zod-like errors array (from .parse() that somehow bypasses instanceof)
    if (Array.isArray((e as any).errors) && (e as any).errors[0]?.message) {
      return (e as any).errors[0].message;
    }
  }

  // NEVER return raw e.message in production — it may contain:
  // - SQL queries, table names
  // - file paths, connection strings
  // - internal function names / stack traces
  return "Something went wrong";
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null;
}
