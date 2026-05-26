import { prisma } from "./prisma";

/**
 * Editable hero content shown on the public homepage.
 * Stored as a single JSON value under the `homepage` key in the existing
 * Setting model — no schema changes required.
 *
 * The defaults below match the current hardcoded text exactly, so the
 * homepage looks identical until an admin edits it from the panel.
 */

export const HOMEPAGE_KEY = "homepage";

export type HomepageContent = {
  /** Brand text shown next to the logo mark. Use " · " to split into
   *  neon-gradient prefix + slate suffix (matches existing visual). */
  brandName: string;
  /** Small pill above the hero title. */
  heroBadge: string;
  /** Main hero h1. */
  heroTitle: string;
  /** Substring of `heroTitle` to render with the neon gradient. Empty
   *  string disables the gradient highlight. */
  heroTitleGradient: string;
  /** Sub-paragraph below the title. */
  heroSubtitle: string;
  /** Tiny line at the bottom of the hero (next to the activity icon). */
  heroFooter: string;
};

export const DEFAULT_HOMEPAGE: HomepageContent = {
  brandName: "PT Sontoloyo · Monitor",
  heroBadge: "Monitoring Server · Live",
  heroTitle:
    "Selamat datang di pusat monitoring Server VPN PREMIUM PT Sontoloyo",
  heroTitleGradient: "monitoring Server VPN PREMIUM",
  heroSubtitle:
    "Pantau status, slot, kecepatan, ping, semua server langsung dari sini serta kesehatan seluruh service server VPN SSH/XRAY dalam satu website yang otomatis update setiap beberapa detik.",
  heroFooter: "Data live · langsung dari server",
};

/** Read merged content (defaults + saved overrides). */
export async function getHomepage(): Promise<HomepageContent> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: HOMEPAGE_KEY } });
    if (!row?.value) return DEFAULT_HOMEPAGE;
    const parsed = JSON.parse(row.value) as Partial<HomepageContent>;
    return { ...DEFAULT_HOMEPAGE, ...parsed };
  } catch {
    return DEFAULT_HOMEPAGE;
  }
}

/** Persist a fully-validated homepage content payload. */
export async function setHomepage(content: HomepageContent): Promise<void> {
  await prisma.setting.upsert({
    where: { key: HOMEPAGE_KEY },
    create: { key: HOMEPAGE_KEY, value: JSON.stringify(content) },
    update: { value: JSON.stringify(content) },
  });
}

/**
 * Split brand text on " · " (with surrounding spaces) for the existing
 * "neon-prefix · slate-suffix" visual treatment in the Logo component.
 * Returns just `{ brand }` when the separator is absent so the caller
 * can render the whole string as gradient.
 */
export function splitBrandText(text: string): { brand: string; suffix?: string } {
  const sep = " · ";
  const idx = text.indexOf(sep);
  if (idx === -1) return { brand: text };
  return { brand: text.slice(0, idx), suffix: text.slice(idx + sep.length) };
}
