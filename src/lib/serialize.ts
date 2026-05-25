// Convert BigInt fields (Prisma) to number/string so they can be JSON-serialized.
export function serializeServer<T extends Record<string, any>>(s: T): T {
  const o: any = { ...s };
  if (typeof o.rxBytes === "bigint") o.rxBytes = Number(o.rxBytes);
  if (typeof o.txBytes === "bigint") o.txBytes = Number(o.txBytes);
  return o;
}

export function serializeServers<T extends Record<string, any>>(arr: T[]): T[] {
  return arr.map(serializeServer);
}
