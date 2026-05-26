"use client";
import { useEffect, useState } from "react";
import { Activity, RefreshCcw, RotateCcw, Save, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import {
  DEFAULT_HOMEPAGE,
  type HomepageContent,
  splitBrandText,
} from "@/lib/homepage";
import { broadcastHomepageUpdated, useHomepage } from "@/hooks/useHomepage";
import { HighlightTitle } from "@/components/ui/HighlightTitle";

export default function AdminHomepagePage() {
  const { content, loaded, refresh } = useHomepage();

  const [form, setForm] = useState<HomepageContent>(DEFAULT_HOMEPAGE);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Sync form once content from server arrives.
  useEffect(() => {
    if (loaded) setForm(content);
  }, [loaded, content]);

  function set<K extends keyof HomepageContent>(key: K, value: HomepageContent[K]) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/homepage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Save failed");
      toast.success("Homepage tersimpan");
      await refresh();
      broadcastHomepageUpdated();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function resetDefaults() {
    if (!confirm("Reset semua field ke teks default bawaan?")) return;
    setResetting(true);
    try {
      const res = await fetch("/api/homepage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(DEFAULT_HOMEPAGE),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Reset failed");
      toast.success("Homepage direset ke default");
      setForm(DEFAULT_HOMEPAGE);
      await refresh();
      broadcastHomepageUpdated();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setResetting(false);
    }
  }

  const { brand: previewBrand, suffix: previewSuffix } = splitBrandText(form.brandName);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            <span className="neon-text">Homepage</span> Content
          </h1>
          <p className="text-sm text-slate-400">
            Edit teks branding dan hero section yang tampil di halaman publik.
          </p>
        </div>
        <button
          onClick={resetDefaults}
          disabled={resetting || saving}
          className="btn-ghost text-xs"
          title="Reset semua field ke teks default"
        >
          {resetting ? <RefreshCcw size={14} className="animate-spin" /> : <RotateCcw size={14} />}
          Reset Default
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ─── Form ─── */}
        <form
          onSubmit={(e) => { e.preventDefault(); save(); }}
          className="glass space-y-4 p-5"
        >
          <Field
            label="Website Name"
            hint='Pisahkan dengan " · " untuk efek "neon · slate" (mis: "PT Sontoloyo · Monitor").'
          >
            <input
              className="input"
              maxLength={120}
              value={form.brandName}
              onChange={(e) => set("brandName", e.target.value)}
              required
            />
          </Field>

          <Field label="Hero Badge Text">
            <input
              className="input"
              maxLength={120}
              value={form.heroBadge}
              onChange={(e) => set("heroBadge", e.target.value)}
              required
            />
          </Field>

          <Field label="Hero Title">
            <input
              className="input"
              maxLength={300}
              value={form.heroTitle}
              onChange={(e) => set("heroTitle", e.target.value)}
              required
            />
          </Field>

          <Field
            label="Highlight Words (Gradient)"
            hint="Kata yang persis cocok di Hero Title akan diberi gradient neon. Kosongkan untuk menonaktifkan."
          >
            <input
              className="input"
              maxLength={200}
              placeholder="contoh: monitoring Server VPN PREMIUM"
              value={form.heroTitleGradient}
              onChange={(e) => set("heroTitleGradient", e.target.value)}
            />
          </Field>

          <Field label="Hero Subtitle">
            <textarea
              className="input min-h-[110px] resize-y leading-relaxed"
              maxLength={1000}
              value={form.heroSubtitle}
              onChange={(e) => set("heroSubtitle", e.target.value)}
              required
            />
          </Field>

          <Field label="Small Bottom Text">
            <input
              className="input"
              maxLength={200}
              value={form.heroFooter}
              onChange={(e) => set("heroFooter", e.target.value)}
              required
            />
          </Field>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="submit" disabled={saving || resetting} className="btn-primary">
              {saving ? <RefreshCcw size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? "Menyimpan..." : "Simpan Homepage"}
            </button>
          </div>
        </form>

        {/* ─── Preview ─── */}
        <div className="space-y-4">
          <div className="glass p-5">
            <div className="mb-3 flex items-center gap-2 text-cyan-300">
              <Sparkles size={16} />
              <h3 className="text-sm font-semibold uppercase tracking-wider">Preview Logo Text</h3>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/30 p-4">
              <span className="font-bold tracking-tight text-xl">
                <span className="neon-text">{previewBrand}</span>
                {previewSuffix !== undefined && (
                  <>
                    <span className="text-slate-400"> · </span>
                    <span className="text-slate-300">{previewSuffix}</span>
                  </>
                )}
              </span>
            </div>
          </div>

          <div className="glass relative overflow-hidden p-5">
            <div className="pointer-events-none absolute -top-16 -right-12 h-48 w-48 rounded-full bg-gradient-to-br from-cyan-400/15 to-purple-500/10 blur-3xl" />
            <div className="relative">
              <div className="mb-3 flex items-center gap-2 text-cyan-300">
                <Sparkles size={16} />
                <h3 className="text-sm font-semibold uppercase tracking-wider">Preview Hero</h3>
              </div>

              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/5 px-3 py-1 text-xs text-cyan-300">
                <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-emerald-400" />
                {form.heroBadge || "—"}
              </div>

              <HighlightTitle
                as="h2"
                className="text-xl font-extrabold leading-tight tracking-tight md:text-2xl"
                text={form.heroTitle}
                gradient={form.heroTitleGradient}
              />

              <p className="mt-2 text-xs leading-relaxed text-slate-400 md:text-sm">
                {form.heroSubtitle}
              </p>

              <div className="mt-3 inline-flex items-center gap-2 text-[11px] text-slate-500">
                <Activity size={12} className="text-cyan-300" />
                {form.heroFooter}
              </div>
            </div>
          </div>

          <div className="glass p-4 text-[11px] text-slate-500">
            <strong className="text-slate-300">Tips:</strong>{" "}
            Highlight Words harus cocok PERSIS (case-sensitive) dengan substring di Hero Title.
            Jika tidak ditemukan, title akan tampil polos tanpa gradient.
          </div>
        </div>
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
