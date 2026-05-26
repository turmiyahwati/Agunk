import { prisma } from "./prisma";

/**
 * Editable Protocol Information cards shown on the public homepage.
 * Stored as a single JSON value under the `protocols` key in the existing
 * Setting model — no schema changes required.
 *
 * Defaults below match the previous hardcoded ProtocolInfo.tsx exactly,
 * so the card grid stays visually identical until an admin edits it.
 *
 * Icons / tone classes are intentionally NOT stored — they are mapped
 * from the protocol `slug` inside the component layer so the look stays
 * consistent across edits.
 */

export const PROTOCOLS_KEY = "protocols";

/** Stable identifier used for icon + tone mapping. Cannot be edited. */
export const PROTOCOL_SLUGS = ["SSH", "VMESS", "VLESS", "TROJAN"] as const;
export type ProtocolSlug = (typeof PROTOCOL_SLUGS)[number];

export type ProtocolItem = {
  slug: ProtocolSlug;
  /** Display label (admin-editable, defaults to slug). */
  name: string;
  /** Optional one-line subtitle below the name. Empty string = no render. */
  description: string;
  bullet1: string;
  bullet2: string;
  /** Hide the card on the public page when false. */
  active: boolean;
};

export const DEFAULT_PROTOCOLS: ProtocolItem[] = [
  {
    slug: "SSH",
    name: "SSH",
    description: "",
    bullet1: "Stabil & hemat kuota",
    bullet2: "Cocok browsing dan sosial media",
    active: true,
  },
  {
    slug: "VMESS",
    name: "VMESS",
    description: "",
    bullet1: "Cepat & fleksibel",
    bullet2: "Cocok streaming dan harian",
    active: true,
  },
  {
    slug: "VLESS",
    name: "VLESS",
    description: "",
    bullet1: "Ringan & modern",
    bullet2: "Ping lebih stabil",
    active: true,
  },
  {
    slug: "TROJAN",
    name: "TROJAN",
    description: "",
    bullet1: "Koneksi lebih aman",
    bullet2: "Cocok jaringan ketat",
    active: true,
  },
];

/**
 * Always returns exactly four entries in the canonical PROTOCOL_SLUGS
 * order. Any missing or malformed entries fall back to defaults.
 */
export async function getProtocols(): Promise<ProtocolItem[]> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: PROTOCOLS_KEY } });
    if (!row?.value) return DEFAULT_PROTOCOLS;
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return DEFAULT_PROTOCOLS;
    return PROTOCOL_SLUGS.map((slug) => {
      const fromStorage = parsed.find(
        (p: any) => p && typeof p === "object" && p.slug === slug,
      );
      const fallback = DEFAULT_PROTOCOLS.find((p) => p.slug === slug)!;
      if (!fromStorage) return fallback;
      return {
        slug,
        name: typeof fromStorage.name === "string" ? fromStorage.name : fallback.name,
        description:
          typeof fromStorage.description === "string"
            ? fromStorage.description
            : fallback.description,
        bullet1: typeof fromStorage.bullet1 === "string" ? fromStorage.bullet1 : fallback.bullet1,
        bullet2: typeof fromStorage.bullet2 === "string" ? fromStorage.bullet2 : fallback.bullet2,
        active: typeof fromStorage.active === "boolean" ? fromStorage.active : fallback.active,
      };
    });
  } catch {
    return DEFAULT_PROTOCOLS;
  }
}

/** Persist the full ordered protocol list. */
export async function setProtocols(items: ProtocolItem[]): Promise<void> {
  await prisma.setting.upsert({
    where: { key: PROTOCOLS_KEY },
    create: { key: PROTOCOLS_KEY, value: JSON.stringify(items) },
    update: { value: JSON.stringify(items) },
  });
}
