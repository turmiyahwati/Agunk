"use client";
import { motion } from "framer-motion";
import { Terminal, Rocket, Zap, ShieldCheck } from "lucide-react";

type ProtocolCard = {
  name: string;
  icon: React.ComponentType<any>;
  bullets: string[];
  tone: string; // border + glow tint
};

const PROTOCOLS: ProtocolCard[] = [
  {
    name: "SSH",
    icon: Terminal,
    tone: "from-cyan-400/15 to-cyan-400/0 text-cyan-300",
    bullets: ["Stabil & hemat kuota", "Cocok browsing dan sosial media"],
  },
  {
    name: "VMESS",
    icon: Rocket,
    tone: "from-purple-500/15 to-purple-500/0 text-purple-300",
    bullets: ["Cepat & fleksibel", "Cocok streaming dan harian"],
  },
  {
    name: "VLESS",
    icon: Zap,
    tone: "from-emerald-400/15 to-emerald-400/0 text-emerald-300",
    bullets: ["Ringan & modern", "Ping lebih stabil"],
  },
  {
    name: "TROJAN",
    icon: ShieldCheck,
    tone: "from-rose-400/15 to-rose-400/0 text-rose-300",
    bullets: ["Koneksi lebih aman", "Cocok jaringan ketat"],
  },
];

/**
 * Lightweight static section that explains the four protocols available
 * across the network in plain language. No technical jargon.
 */
export function ProtocolInfo() {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight md:text-lg">
            <span className="neon-text">Protocol</span> Information
          </h2>
          <p className="text-xs text-slate-400">
            Pilih protocol yang paling cocok dengan kebutuhan kamu.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PROTOCOLS.map((p, i) => {
          const Icon = p.icon;
          return (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              className="glass glass-hover relative overflow-hidden p-5"
            >
              <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${p.tone}`} />
              <div className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full bg-gradient-to-br from-cyan-400/10 to-purple-500/5 blur-2xl" />

              <div className="relative">
                <div className={`mb-3 grid h-9 w-9 place-items-center rounded-lg bg-white/[0.04] ring-1 ring-white/10 ${p.tone}`}>
                  <Icon size={16} />
                </div>
                <div className="text-sm font-bold tracking-wider">{p.name}</div>
                <ul className="mt-2 space-y-1 text-xs text-slate-400">
                  {p.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-1.5">
                      <span className="mt-1 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-cyan-300/60" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
