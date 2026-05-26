"use client";
import Link from "next/link";
import { LogIn, MessageCircle } from "lucide-react";

const WA_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "";
const WA_TEXT =
  process.env.NEXT_PUBLIC_WHATSAPP_TEXT ||
  "Halo Admin, saya ingin info lebih lanjut soal layanan VPN/Xray.";

/**
 * Top-right slim contact bar visible on the public monitoring view.
 * - "Hubungi Admin" → opens WhatsApp chat
 * - "Masuk Admin"   → routes to /login
 *
 * Sized small + glassmorphism + neon — does not disrupt existing layout.
 */
export function ContactBar() {
  const waHref = WA_NUMBER
    ? `https://wa.me/${WA_NUMBER.replace(/\D/g, "")}?text=${encodeURIComponent(WA_TEXT)}`
    : "#";

  return (
    <div className="flex items-center gap-2">
      {WA_NUMBER && (
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200 backdrop-blur transition-all hover:bg-emerald-400/15 hover:shadow-[0_0_18px_rgba(34,197,94,0.35)]"
          aria-label="Hubungi Admin via WhatsApp"
        >
          <MessageCircle size={13} />
          <span className="hidden sm:inline">Hubungi Admin</span>
        </a>
      )}
      <Link
        href="/login"
        className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-300/25 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-200 backdrop-blur transition-all hover:border-cyan-300/45 hover:text-white hover:shadow-glow-sm"
        aria-label="Masuk sebagai Admin"
      >
        <LogIn size={13} />
        <span className="hidden sm:inline">Masuk Admin</span>
      </Link>
    </div>
  );
}
