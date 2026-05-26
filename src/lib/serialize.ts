/**
 * Convert BigInt fields (Prisma) to number so they can be JSON-serialized.
 *
 * SECURITY NOTE: This does NOT filter sensitive fields. Sensitive field
 * protection is handled at two levels:
 * 1. Member routes: Prisma `select` explicitly lists only safe fields
 * 2. Admin routes: guarded by `requireAdmin()` middleware
 *
 * Fields that must NEVER reach member-facing responses:
 * - apiKey, apiUrl, lastError, password, refreshMs
 */
export function serializeServer<T extends Record<string, any>>(s: T): T {
  const o: any = { ...s };
  if (typeof o.rxBytes === "bigint") o.rxBytes = Number(o.rxBytes);
  if (typeof o.txBytes === "bigint") o.txBytes = Number(o.txBytes);
  return o;
}

export function serializeServers<T extends Record<string, any>>(arr: T[]): T[] {
  return arr.map(serializeServer);
}
