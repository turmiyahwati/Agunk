import Link from "next/link";
import { ArrowRight, Activity, Globe2, ShieldCheck, Zap, Server, Rss } from "lucide-react";
import { Logo } from "@/components/ui/Logo";

export default function Landing() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Nav */}
      <nav className="container mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <div className="flex items-center gap-3">
          <Link href="/login" className="btn-ghost">Login</Link>
          <Link href="/register" className="btn-primary">
            Get Started <ArrowRight size={16} />
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="container mx-auto max-w-6xl px-6 pt-20 pb-24 text-center">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/5 px-3 py-1 text-xs text-cyan-300">
          <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-emerald-400" />
          Real-time monitoring · v1.0
        </div>
        <h1 className="mx-auto max-w-3xl text-5xl font-extrabold leading-tight md:text-6xl">
          Premium <span className="neon-text">VPN / Xray</span><br />
          monitoring dashboard
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-slate-400 md:text-lg">
          Pantau status, slot, traffic, dan kesehatan semua server VPN/Xray Anda dalam satu panel
          futuristic dengan data realtime dari VPS agent.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/register" className="btn-primary">
            Buat Akun Member <ArrowRight size={16} />
          </Link>
          <Link href="/login" className="btn-ghost">Login Dashboard</Link>
        </div>
      </section>

      {/* Feature grid */}
      <section className="container mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-4 md:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="glass glass-hover p-6">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/20 to-purple-500/20 text-cyan-300">
                <f.icon size={20} />
              </div>
              <h3 className="mb-1 font-semibold">{f.title}</h3>
              <p className="text-sm text-slate-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="container mx-auto max-w-6xl border-t border-white/5 px-6 py-8 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} Agunk Monitor — Built for premium VPN/Xray operators.
      </footer>
    </main>
  );
}

const features = [
  { icon: Activity,   title: "Realtime Health",  desc: "CPU, RAM, ping, dan traffic RX/TX update otomatis tiap beberapa detik." },
  { icon: Server,     title: "Multi-Server",     desc: "Tambah server VPS sebanyak yang Anda mau. Skala scalable tanpa batas." },
  { icon: Globe2,     title: "Per-Country View", desc: "Filter cepat berdasarkan negara, provider VPS, atau status server." },
  { icon: ShieldCheck,title: "Secure by Default",desc: "API key + JWT auth. Kredensial server tidak pernah keluar ke client." },
  { icon: Zap,        title: "Auto Status",      desc: "Status FULL / WARNING / OFFLINE dihitung otomatis dari user aktif." },
  { icon: Rss,        title: "VPS Agent Ready",  desc: "Drop-in Python agent untuk Debian/Ubuntu — install 1 baris perintah." },
];
