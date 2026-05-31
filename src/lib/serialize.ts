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
  // All BigInt-typed traffic counter columns need conversion. Centralized
  // here so any future column added with `BigInt` in schema.prisma just
  // needs to be appended to this list.
  for (const key of [
    "rxBytes",
    "txBytes",
    "rxBytesToday",
    "txBytesToday",
    "rxBytesBoot",
    "txBytesBoot",
  ]) {
    if (typeof o[key] === "bigint") o[key] = Number(o[key]);
  }
  return o;
}

export function serializeServers<T extends Record<string, any>>(arr: T[]): T[] {
  return arr.map(serializeServer);
}
