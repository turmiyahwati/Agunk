"use client";
import { motion } from "framer-motion";
import { Activity } from "lucide-react";
import { useHomepage } from "@/hooks/useHomepage";
import { HighlightTitle } from "./ui/HighlightTitle";

/**
 * Friendly hero strip placed above the public monitoring grid.
 * Reuses existing glassmorphism + neon classes — does not introduce new style.
 * Text content is editable via /admin/homepage.
 */
export function WelcomeBanner() {
  const { content } = useHomepage();

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="glass relative overflow-hidden p-6 md:p-8"
    >
      <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-gradient-to-br from-cyan-400/20 to-purple-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-gradient-to-tr from-purple-500/15 to-cyan-400/10 blur-3xl" />

      <div className="relative">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/5 px-3 py-1 text-xs text-cyan-300">
          <span className="grid h-3 w-3 place-items-center">
            <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-emerald-400" />
          </span>
          {content.heroBadge}
        </div>

        <HighlightTitle
          as="h1"
          className="text-3xl font-extrabold leading-tight tracking-tight md:text-4xl"
          text={content.heroTitle}
          gradient={content.heroTitleGradient}
        />

        <p className="mt-3 max-w-2xl text-sm text-slate-400 md:text-base">
          {content.heroSubtitle}
        </p>

        <div className="mt-4 inline-flex items-center gap-2 text-xs text-slate-500">
          <Activity size={14} className="text-cyan-300" />
          {content.heroFooter}
        </div>
      </div>
    </motion.section>
  );
}
