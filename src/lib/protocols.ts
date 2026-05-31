import { prisma } from "./prisma";

/**
 * Editable Protocol Information cards shown on the public homepage.
 * Stored as a single JSON value under the `protocols` key in the existing
 * Setting model — no schema changes required.
 *
 * Field overview:
 *  - LEGACY (kept for backward compat, no longer rendered on the public
 *    page): description, bullet1, bullet2
 *  - NEW (drive the redesigned tabbed card):
 *      subtitle, body,
 *      feature1Label / feature1Value,
 *      feature2Label / feature2Value,
 *      feature3Label / feature3Value
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
  /**
   * @deprecated Legacy field for the old protocol card layout. Use
   * subtitle/body/feature{N}{Label,Value} for the new tabbed card. Will
   * be removed in v2.0.
   */
  description: string;
  /**
   * @deprecated Legacy field for the old protocol card layout. Use
   * subtitle/body/feature{N}{Label,Value} for the new tabbed card. Will
   * be removed in v2.0.
   */
  bullet1: string;
  /**
   * @deprecated Legacy field for the old protocol card layout. Use
   * subtitle/body/feature{N}{Label,Value} for the new tabbed card. Will
   * be removed in v2.0.
   */
  bullet2: string;
  /** Hide the card on the public page when false. */
  active: boolean;

  // ─── New fields used by the tabbed card design ───
  /** Short tagline shown below the title in the active card. */
  subtitle: string;
  /** Long paragraph body rendered below the subtitle. */
  body: string;
  /** Three small "spec" boxes below the body. Pair label + value. */
  feature1Label: string;
  feature1Value: string;
  feature2Label: string;
  feature2Value: string;
  feature3Label: string;
  feature3Value: string;
};

export const DEFAULT_PROTOCOLS: ProtocolItem[] = [
  {
    slug: "SSH",
    name: "SSH",
    description: "",
    bullet1: "Stabil & hemat kuota",
    bullet2: "Cocok browsing dan sosial media",
    active: true,
    subtitle: "Stabil & kompatibel universal",
    body:
      "Tunnel klasik berbasis SSH dengan transport WebSocket yang mudah lewat di hampir semua jaringan operator. Cocok untuk pemakaian harian, browsing, dan media sosial dengan kuota irit.",
    feature1Label: "Port",
    feature1Value: "443 / 22",
    feature2Label: "Enkripsi",
    feature2Value: "AES-256",
    feature3Label: "Latensi",
    feature3Value: "Stabil",
  },
  {
    slug: "VMESS",
    name: "VMESS",
    description: "",
    bullet1: "Cepat & fleksibel",
    bullet2: "Cocok streaming dan harian",
    active: true,
    subtitle: "Protocol V2Ray generasi awal",
    body:
      "VMESS adalah protocol V2Ray klasik dengan dukungan TLS dan WebSocket. Lebih fleksibel dan cepat dibanding SSH biasa, cocok untuk streaming, gaming ringan, dan multitasking harian.",
    feature1Label: "Transport",
    feature1Value: "WS / TLS",
    feature2Label: "Latensi",
    feature2Value: "Rendah",
    feature3Label: "Performa",
    feature3Value: "Tinggi",
  },
  {
    slug: "VLESS",
    name: "VLESS",
    description: "",
    bullet1: "Ringan & modern",
    bullet2: "Ping lebih stabil",
    active: true,
    subtitle: "Lebih ringan dari VMess",
    body:
      "VLESS adalah protocol V2Ray modern tanpa overhead enkripsi tambahan dari VMess. Lebih efisien, ping lebih stabil, dan ideal untuk koneksi jangka panjang serta streaming kualitas tinggi.",
    feature1Label: "Transport",
    feature1Value: "WS / GRPC",
    feature2Label: "Latensi",
    feature2Value: "Sangat Rendah",
    feature3Label: "Stealth",
    feature3Value: "Modern",
  },
  {
    slug: "TROJAN",
    name: "TROJAN",
    description: "",
    bullet1: "Koneksi lebih aman",
    bullet2: "Cocok jaringan ketat",
    active: true,
    subtitle: "Menyamar sebagai HTTPS",
    body:
      "Trojan menyamarkan trafik VPN sebagai HTTPS biasa, sehingga sangat sulit difilter oleh DPI (Deep Packet Inspection). Pilihan terbaik di jaringan kantor, kampus, atau hotspot dengan firewall ketat.",
    feature1Label: "Bypass DPI",
    feature1Value: "Tinggi",
    feature2Label: "Stealth",
    feature2Value: "Premium",
    feature3Label: "Stabilitas",
    feature3Value: "Sangat Stabil",
  },
];

/**
 * Defensive read.  Always returns four canonically-ordered entries.
 * Each field is taken from storage when present and well-typed,
 * otherwise it falls back to the per-protocol default — so older saved
 * payloads (without the new fields) automatically gain sensible values
 * without any migration step.
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
      const pickStr = (k: keyof ProtocolItem) =>
        typeof (fromStorage as any)[k] === "string"
          ? ((fromStorage as any)[k] as string)
          : (fallback[k] as string);
      const pickBool = (k: keyof ProtocolItem) =>
        typeof (fromStorage as any)[k] === "boolean"
          ? ((fromStorage as any)[k] as boolean)
          : (fallback[k] as boolean);
      return {
        slug,
        name: pickStr("name"),
        description: pickStr("description"),
        bullet1: pickStr("bullet1"),
        bullet2: pickStr("bullet2"),
        active: pickBool("active"),
        subtitle: pickStr("subtitle"),
        body: pickStr("body"),
        feature1Label: pickStr("feature1Label"),
        feature1Value: pickStr("feature1Value"),
        feature2Label: pickStr("feature2Label"),
        feature2Value: pickStr("feature2Value"),
        feature3Label: pickStr("feature3Label"),
        feature3Value: pickStr("feature3Value"),
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
