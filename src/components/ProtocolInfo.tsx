"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, Rocket, Zap, ShieldCheck } from "lucide-react";
import { useProtocols } from "@/hooks/useProtocols";
import type { ProtocolItem, ProtocolSlug } from "@/lib/protocols";

const ICON_MAP: Record<ProtocolSlug, React.ComponentType<any>> = {
  SSH: Terminal,
  VMESS: Rocket,
  VLESS: Zap,
  TROJAN: ShieldCheck,
};

const TONE_MAP: Record<ProtocolSlug, string> = {
  SSH: "from-cyan-400/20 to-cyan-400/0 text-cyan-300",
  VMESS: "from-purple-500/20 to-purple-500/0 text-purple-300",
  VLESS: "from-emerald-400/20 to-emerald-400/0 text-emerald-300",
  TROJAN: "from-rose-400/20 to-rose-400/0 text-rose-300",
};

/**
 * Tabbed Protocol Information card.
 *
 *  ┌────────────────────────────────────────────────┐
 *  │  [SSH]  [VMESS]  [VLESS]  [TROJAN]             │   ← pill switcher
 *  ├────────────────────────────────────────────────┤
 *  │  ⌬  TITLE                                       │
 *  │     subtitle                                    │
 *  │                                                 │
 *  │  body description ...                           │
 *  │                                                 │
 *  │  ┌────────┐  ┌────────┐  ┌────────┐             │   ← feature boxes
 *  │  │ Port   │  │ Lat.   │  │ Perf.  │             │
 *  │  │ 443/22 │  │ Rendah │  │ Tinggi │             │
 *  │  └────────┘  └────────┘  └────────┘             │
 *  └────────────────────────────────────────────────┘
 *
 *  - Inactive items (active: false) are hidden from tabs.
 *  - If every item is inactive the whole section is omitted.
 *  - Content is fully editable from /admin/protocols.
 */
export function ProtocolInfo() {
  const { items } = useProtocols();
  const visible = items.filter((p) => p.active);

  const [activeSlug, setActiveSlug] = useState<ProtocolSlug | null>(null);

  // Keep the selected tab valid as items toggle on/off.
  useEffect(() => {
    if (visible.length === 0) {
      setActiveSlug(null);
      return;
    }
    if (!activeSlug || !visible.find((p) => p.slug === activeSlug)) {
      setActiveSlug(visible[0].slug);
    }
  }, [visible, activeSlug]);

  if (visible.length === 0) return null;

  const active: ProtocolItem = visible.find((p) => p.slug === activeSlug) ?? visible[0];
  const Icon = ICON_MAP[active.slug];
  const tone = TONE_MAP[active.slug];

  const features: Array<{ label: string; value: string }> = [
    { label: active.feature1Label, value: active.feature1Value },
    { label: active.feature2Label, value: active.feature2Value },
    { label: active.feature3Label, value: active.feature3Value },
  ].filter((f) => f.label || f.value);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight md:text-lg">
          <span className="neon-text">Protocol</span> Information
        </h2>
        <p className="text-xs text-slate-400">
          Pilih protocol yang paling cocok dengan kebutuhan kamu.
        </p>
      </div>

      {/* ─── Tab pill switcher ─── */}
      <div className="flex flex-wrap gap-2">
        {visible.map((p) => {
          const isActive = p.slug === active.slug;
          const TabIcon = ICON_MAP[p.slug];
          return (
            <button
              key={p.slug}
              type="button"
              onClick={() => setActiveSlug(p.slug)}
              className="relative inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition-colors"
              aria-pressed={isActive}
            >
              {isActive && (
                <motion.span
                  layoutId="protocol-active-pill"
                  className="absolute inset-0 rounded-full border border-cyan-300/40 bg-cyan-400/10 shadow-glow-sm"
                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                />
              )}
              <span className={`relative z-10 inline-flex items-center gap-2 ${isActive ? "text-white" : "text-slate-400 hover:text-slate-200"}`}>
                <TabIcon size={14} />
                {p.name}
              </span>
            </button>
          );
        })}
      </div>

      {/* ─── Active content card ─── */}
      <AnimatePresence mode="wait">
        <motion.article
          key={active.slug}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="glass relative overflow-hidden p-6 md:p-8"
        >
          <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${tone}`} />
          <div className="pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-gradient-to-br from-cyan-400/15 to-purple-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-12 h-48 w-48 rounded-full bg-gradient-to-tr from-purple-500/10 to-cyan-400/10 blur-3xl" />

          <div className="relative space-y-5">
            {/* Header: icon + title + subtitle */}
            <div className="flex items-start gap-4">
              <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/[0.04] ring-1 ring-white/10 ${tone}`}>
                <Icon size={26} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-2xl font-extrabold tracking-tight md:text-3xl">
                  {active.name}
                </h3>
                {active.subtitle && (
                  <p className="mt-1 text-sm text-slate-400 md:text-[15px]">
                    {active.subtitle}
                  </p>
                )}
              </div>
            </div>

            {/* Body description */}
            {active.body && (
              <p className="max-w-3xl whitespace-pre-line text-sm leading-relaxed text-slate-300/90 md:text-base">
                {active.body}
              </p>
            )}

            {/* Feature boxes */}
            {features.length > 0 && (
              <div className="grid gap-3 pt-1 sm:grid-cols-3">
                {features.map((f, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:border-cyan-300/20 hover:bg-white/[0.04]"
                  >
                    <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      {f.label || "—"}
                    </div>
                    <div className="mt-1 text-base font-semibold tracking-tight text-white md:text-lg">
                      {f.value || "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.article>
      </AnimatePresence>
    </section>
  );
}
