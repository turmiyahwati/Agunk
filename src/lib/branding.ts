import { prisma } from "./prisma";

/**
 * Centralized branding configuration helpers.
 * The custom logo URL is stored in the Setting key/value table.
 */

export const LOGO_KEY = "logo";

/** Returns the current uploaded logo URL or null if default is in use. */
export async function getLogoUrl(): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: LOGO_KEY } });
    return row?.value || null;
  } catch {
    return null;
  }
}

/** Persist a new logo URL (server-generated path). */
export async function setLogoUrl(url: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: LOGO_KEY },
    create: { key: LOGO_KEY, value: url },
    update: { value: url },
  });
}

/** Remove the custom logo (revert to bundled default SVG mark). */
export async function clearLogoUrl(): Promise<void> {
  await prisma.setting.delete({ where: { key: LOGO_KEY } }).catch(() => {});
}

/** Allowed mime types for logo uploads. */
export const ALLOWED_LOGO_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** Magic-byte signatures for defense-in-depth content-type validation. */
export function detectImageMime(bytes: Uint8Array): (typeof ALLOWED_LOGO_MIME)[number] | null {
  if (bytes.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // WEBP: RIFF .... WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

/** Hard upper bound for upload size (in bytes). 1 MB is plenty for a logo. */
export const MAX_LOGO_BYTES = 1 * 1024 * 1024;
