"use client";
import { useRef, useState } from "react";
import Image from "next/image";
import { Upload, RefreshCcw, Trash2, ImageIcon } from "lucide-react";
import toast from "react-hot-toast";
import { broadcastBrandingUpdated, useBranding } from "@/hooks/useBranding";

const ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_BYTES = 1 * 1024 * 1024;

export default function AdminBrandingPage() {
  const { logo, refresh, loaded } = useBranding();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function pickFile(file: File | null) {
    if (!file) {
      setPendingFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!ACCEPT.split(",").includes(file.type)) {
      toast.error("Format harus PNG, JPEG, atau WEBP");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`Ukuran maksimal ${Math.round(MAX_BYTES / 1024)} KB`);
      return;
    }
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function upload() {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", pendingFile);
      const res = await fetch("/api/branding", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Upload gagal");
      toast.success("Logo berhasil disimpan");
      setPendingFile(null);
      setPreviewUrl(null);
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
      broadcastBrandingUpdated();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function resetDefault() {
    if (!confirm("Reset ke logo default bawaan?")) return;
    setResetting(true);
    try {
      const res = await fetch("/api/branding", { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Reset gagal");
      toast.success("Logo direset ke default");
      setPendingFile(null);
      setPreviewUrl(null);
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
      broadcastBrandingUpdated();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          <span className="neon-text">Branding</span> · Custom Logo
        </h1>
        <p className="text-sm text-slate-400">
          Ganti logo website. Logo otomatis berubah di semua halaman setelah disimpan.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="glass p-5">
          <div className="mb-3 flex items-center gap-2 text-cyan-300">
            <ImageIcon size={16} />
            <h3 className="text-sm font-semibold uppercase tracking-wider">Logo Aktif</h3>
          </div>
          <div className="flex h-40 items-center justify-center rounded-xl border border-white/10 bg-black/30">
            {!loaded ? (
              <span className="text-xs text-slate-500">Memuat...</span>
            ) : logo ? (
              <Image
                src={logo}
                alt="Current logo"
                width={160}
                height={120}
                className="max-h-32 w-auto object-contain"
                unoptimized
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-xs text-slate-500">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-purple-600 shadow-glow-sm">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 text-black" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 18 L12 4 L19 18" />
                    <path d="M8 14 H16" />
                  </svg>
                </div>
                Default logo (bawaan)
              </div>
            )}
          </div>

          <div className="mt-4">
            <button
              onClick={resetDefault}
              disabled={resetting || !logo}
              className="btn-ghost w-full text-xs"
              title={logo ? "Hapus logo custom & kembali ke default" : "Sudah memakai default"}
            >
              {resetting ? <RefreshCcw size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Reset ke Default
            </button>
          </div>
        </div>

        <div className="glass p-5">
          <div className="mb-3 flex items-center gap-2 text-cyan-300">
            <Upload size={16} />
            <h3 className="text-sm font-semibold uppercase tracking-wider">Upload Logo Baru</h3>
          </div>

          <div className="flex h-40 items-center justify-center rounded-xl border border-white/10 bg-black/30">
            {previewUrl ? (
              <Image
                src={previewUrl}
                alt="Preview"
                width={160}
                height={120}
                className="max-h-32 w-auto object-contain"
                unoptimized
              />
            ) : (
              <span className="text-xs text-slate-500">Pilih file untuk preview</span>
            )}
          </div>

          <div className="mt-4 space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              onChange={(e) => pickFile(e.target.files?.[0] || null)}
              className="block w-full text-xs text-slate-300
                         file:mr-3 file:rounded-lg file:border file:border-white/10
                         file:bg-white/5 file:px-3 file:py-1.5 file:text-xs
                         file:font-medium file:text-slate-200 hover:file:bg-white/10
                         file:cursor-pointer"
            />
            <p className="text-[11px] text-slate-500">
              PNG, JPEG, atau WEBP · maksimal {Math.round(MAX_BYTES / 1024)} KB · ukuran ideal 256×256.
            </p>
            <button
              onClick={upload}
              disabled={!pendingFile || uploading}
              className="btn-primary w-full"
            >
              {uploading ? <RefreshCcw size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploading ? "Mengunggah..." : "Simpan Logo"}
            </button>
          </div>
        </div>
      </div>

      <div className="glass p-5 text-xs text-slate-400">
        <strong className="text-slate-300">Catatan:</strong>{" "}
        File logo disimpan lokal di <code className="text-cyan-300">public/uploads/</code> dan
        di-serve oleh Next.js. Pastikan direktori tersebut writable saat deploy ke VPS atau
        hosting panel. Setiap upload menggunakan nama file unik (timestamp) sehingga browser
        otomatis memuat versi terbaru tanpa perlu hard refresh.
      </div>
    </div>
  );
}
