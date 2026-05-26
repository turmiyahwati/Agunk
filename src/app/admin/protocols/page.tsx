"use client";
import { useEffect, useState } from "react";
import { Power, RefreshCcw, RotateCcw, Save, Sparkles, Terminal, Rocket, Zap, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import {
  DEFAULT_PROTOCOLS,
  PROTOCOL_SLUGS,
  type ProtocolItem,
  type ProtocolSlug,
} from "@/lib/protocols";
import { broadcastProtocolsUpdated, useProtocols } from "@/hooks/useProtocols";

const ICON_MAP: Record<ProtocolSlug, React.ComponentType<any>> = {
  SSH: Terminal,
  VMESS: Rocket,
  VLESS: Zap,
  TROJAN: ShieldCheck,
};

const TONE_MAP: Record<ProtocolSlug, string> = {
  SSH: "from-cyan-400/15 to-cyan-400/0 text-cyan-300",
  VMESS: "from-purple-500/15 to-purple-500/0 text-purple-300",
  VLESS: "from-emerald-400/15 to-emerald-400/0 text-emerald-300",
  TROJAN: "from-rose-400/15 to-rose-400/0 text-rose-300",
};

export default function AdminProtocolsPage() {
  const { items, loaded, refresh } = useProtocols();

  const [form, setForm] = useState<ProtocolItem[]>(DEFAULT_PROTOCOLS);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (loaded) setForm(items);
  }, [loaded, items]);

  function patchItem(slug: ProtocolSlug, patch: Partial<ProtocolItem>) {
    setForm((arr) => arr.map((p) => (p.slug === slug ? { ...p, ...patch } : p)));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/protocols", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocols: form }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Save failed");
      toast.success("Protocol Information tersimpan");
      await refresh();
      broadcastProtocolsUpdated();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function resetDefaults() {
    if (!confirm("Reset semua protocol ke teks default bawaan?")) return;
    setResetting(true);
    try {
      const res = await fetch("/api/protocols", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocols: DEFAULT_PROTOCOLS }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Reset failed");
      toast.success("Protocol direset ke default");
      setForm(DEFAULT_PROTOCOLS);
      await refresh();
      broadcastProtocolsUpdated();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setResetting(false);
    }
  }

  // Always render in canonical slug order for stable layout.
  const ordered = PROTOCOL_SLUGS.map((slug) => form.find((p) => p.slug === slug)!).filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            <span className="neon-text">Protocol</span> Content
          </h1>
          <p className="text-sm text-slate-400">
            Edit teks dan visibility tiap card protocol. Icon tetap mengikuti tipe protocol.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetDefaults}
            disabled={resetting || saving}
            className="btn-ghost text-xs"
            title="Reset semua field ke teks default"
          >
            {resetting ? <RefreshCcw size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            Reset Default
          </button>
          <button onClick={save} disabled={saving || resetting} className="btn-primary text-xs">
            {saving ? <RefreshCcw size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Menyimpan..." : "Simpan Semua"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {ordered.map((p) => {
          const Icon = ICON_MAP[p.slug];
          const tone = TONE_MAP[p.slug];
          return (
            <div key={p.slug} className="glass relative overflow-hidden p-5">
              <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${tone}`} />
              <div className="relative space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`grid h-9 w-9 place-items-center rounded-lg bg-white/[0.04] ring-1 ring-white/10 ${tone}`}>
                      <Icon size={16} />
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wider text-slate-500">{p.slug}</div>
                      <div className="text-sm text-slate-300">Card protocol</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => patchItem(p.slug, { active: !p.active })}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] transition-all ${
                      p.active
                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15"
                        : "border-white/10 bg-white/[0.02] text-slate-400 hover:bg-white/[0.05]"
                    }`}
                    aria-label={p.active ? "Set inactive" : "Set active"}
                  >
                    <Power size={12} />
                    {p.active ? "Active" : "Inactive"}
                  </button>
                </div>

                <Field label="Nama Protocol">
                  <input
                    className="input"
                    maxLength={50}
                    value={p.name}
                    onChange={(e) => patchItem(p.slug, { name: e.target.value })}
                    required
                  />
                </Field>

                <Field
                  label="Description / Subtitle (Lama)"
                  hint="Field lama, tidak ditampilkan di tampilan baru. Aman dikosongkan."
                >
                  <input
                    className="input"
                    maxLength={200}
                    placeholder="(opsional)"
                    value={p.description}
                    onChange={(e) => patchItem(p.slug, { description: e.target.value })}
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Bullet 1 (Lama)">
                    <input
                      className="input"
                      maxLength={150}
                      placeholder="(opsional)"
                      value={p.bullet1}
                      onChange={(e) => patchItem(p.slug, { bullet1: e.target.value })}
                    />
                  </Field>
                  <Field label="Bullet 2 (Lama)">
                    <input
                      className="input"
                      maxLength={150}
                      placeholder="(opsional)"
                      value={p.bullet2}
                      onChange={(e) => patchItem(p.slug, { bullet2: e.target.value })}
                    />
                  </Field>
                </div>

                {/* ─── New fields used by the redesigned card ─── */}
                <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.03] p-4">
                  <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-cyan-300">
                    <Sparkles size={12} />
                    Tampilan Baru
                  </div>

                  <div className="space-y-3">
                    <Field
                      label="Subtitle"
                      hint="Tagline pendek yang muncul di bawah judul kartu."
                    >
                      <input
                        className="input"
                        maxLength={200}
                        value={p.subtitle}
                        onChange={(e) => patchItem(p.slug, { subtitle: e.target.value })}
                      />
                    </Field>

                    <Field
                      label="Body Description"
                      hint="Paragraf besar yang menjelaskan protocol. Mendukung baris baru."
                    >
                      <textarea
                        className="input min-h-[100px] resize-y leading-relaxed"
                        maxLength={800}
                        value={p.body}
                        onChange={(e) => patchItem(p.slug, { body: e.target.value })}
                      />
                    </Field>

                    {[1, 2, 3].map((n) => {
                      const labelKey = `feature${n}Label` as keyof ProtocolItem;
                      const valueKey = `feature${n}Value` as keyof ProtocolItem;
                      return (
                        <div key={n} className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
                          <Field label={`Feature ${n} — Label`}>
                            <input
                              className="input"
                              maxLength={50}
                              placeholder={n === 1 ? "Port" : n === 2 ? "Latensi" : "Performa"}
                              value={p[labelKey] as string}
                              onChange={(e) => patchItem(p.slug, { [labelKey]: e.target.value } as Partial<ProtocolItem>)}
                            />
                          </Field>
                          <Field label={`Feature ${n} — Value`}>
                            <input
                              className="input"
                              maxLength={50}
                              placeholder={n === 1 ? "443 / 22" : n === 2 ? "Rendah" : "Tinggi"}
                              value={p[valueKey] as string}
                              onChange={(e) => patchItem(p.slug, { [valueKey]: e.target.value } as Partial<ProtocolItem>)}
                            />
                          </Field>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ─── Mini preview that mirrors the public tabbed card ─── */}
                <div className="rounded-xl border border-white/5 bg-black/30 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-500">
                    <Sparkles size={12} className="text-cyan-300" />
                    Preview
                  </div>
                  <div className="flex items-start gap-3">
                    <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.04] ring-1 ring-white/10 ${tone}`}>
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-base font-bold tracking-tight">{p.name}</div>
                      {p.subtitle && (
                        <div className="text-[11px] text-slate-400">{p.subtitle}</div>
                      )}
                    </div>
                  </div>
                  {p.body && (
                    <p className="mt-2 text-xs leading-relaxed text-slate-300/80">{p.body}</p>
                  )}
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[1, 2, 3].map((n) => {
                      const label = p[`feature${n}Label` as keyof ProtocolItem] as string;
                      const value = p[`feature${n}Value` as keyof ProtocolItem] as string;
                      return (
                        <div key={n} className="rounded-lg border border-white/5 bg-white/[0.02] p-2">
                          <div className="truncate text-[9px] uppercase tracking-wider text-slate-500">
                            {label || "—"}
                          </div>
                          <div className="truncate text-[11px] font-semibold text-white">
                            {value || "—"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {!p.active && (
                    <div className="mt-2 text-[10px] uppercase tracking-wider text-rose-300/80">
                      Hidden on public page
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="glass p-4 text-[11px] text-slate-500">
        <strong className="text-slate-300">Catatan:</strong>{" "}
        Icon tiap card otomatis mengikuti slug protocol (SSH = terminal, VMESS = rocket,
        VLESS = bolt, TROJAN = shield). Slug tidak bisa diubah. Jika semua protocol
        dimatikan, section Protocol Information otomatis tersembunyi di halaman publik.
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}
