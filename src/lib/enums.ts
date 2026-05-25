// Enum-like string unions used across the app.
// Stored in the DB as strings (works for SQLite, Postgres, MySQL).

export const Role = { ADMIN: "ADMIN", MEMBER: "MEMBER" } as const;
export type Role = (typeof Role)[keyof typeof Role];

export const ServerStatus = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  FULL: "FULL",
  WARNING: "WARNING",
  UNKNOWN: "UNKNOWN",
} as const;
export type ServerStatus = (typeof ServerStatus)[keyof typeof ServerStatus];
