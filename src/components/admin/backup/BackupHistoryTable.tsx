"use client";
import { useState } from "react";
import { Download, Mail, Trash2, Lock, ShieldOff } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import type { BackupRecord } from "@/lib/backup";
import toast from "react-hot-toast";

/**
 * Paginated table of backup files on disk.
 *
 * Each row offers three actions:
 *   • Download — streams the file via the API for local archival
 *   • Email — re-sends the file via the configured SMTP profile
 *   • Delete — removes the file from disk (and its sha256 sidecar)
 *
 * Pagination is client-side because the API already returns the full
 * list (capped naturally by retention — typically <50 rows). Shows
 * 10 per page so the UI stays compact on small screens.
 */
const PAGE_SIZE = 10;

export function BackupHistoryTable({
  backups,
  onMutate,
}: {
  backups: BackupRecord[];
  onMutate: () => void;
}) {
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(backups.length / PAGE_SIZE));
  const slice = backups.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  async function emailRow(name: string) {
    setBusy(name);
    try {
      const res = await fetch(`/api/backup/${encodeURIComponent(name)}/email`, {
        method: "POST",
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Email failed");
      toast.success("Email sent");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteRow(name: string) {
    if (!confirm(`Delete backup "${name}"? This cannot be undone.`)) return;
    setBusy(name);
    try {
      const res = await fetch(`/api/backup/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Delete failed");
      toast.success("Backup deleted");
      onMutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (backups.length === 0) {
    return (
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-sm text-slate-500">
        No backups yet. Run one with the <strong>Backup Sekarang</strong> button above,
        or wait for the next cron tick.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-white/[0.02]">
      <table className="w-full text-sm">
        <thead className="border-b border-white/5 bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
          <tr>
            <th className="px-4 py-2.5">Date (WIB)</th>
            <th className="px-4 py-2.5">Size</th>
            <th className="px-4 py-2.5">Encryption</th>
            <th className="px-4 py-2.5">File</th>
            <th className="px-4 py-2.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {slice.map((b) => (
            <tr key={b.name} className="hover:bg-white/[0.03]">
              <td className="px-4 py-2.5 font-mono text-[12px] text-slate-200">
                {formatLocal(b.createdAt)}
              </td>
              <td className="px-4 py-2.5 tabular-nums text-slate-300">{formatBytes(b.size)}</td>
              <td className="px-4 py-2.5">
                {b.encrypted ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-0.5 text-[10px] text-emerald-200">
                    <Lock size={10} /> AES-256
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-300/30 bg-rose-300/10 px-2 py-0.5 text-[10px] text-rose-200">
                    <ShieldOff size={10} /> plaintext
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 max-w-[18rem] truncate font-mono text-[11px] text-slate-500">
                {b.name}
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center justify-end gap-1.5">
                  <a
                    href={`/api/backup/${encodeURIComponent(b.name)}/download`}
                    title="Download"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-slate-300 transition hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-cyan-200"
                  >
                    <Download size={13} />
                  </a>
                  <button
                    type="button"
                    onClick={() => emailRow(b.name)}
                    disabled={busy === b.name}
                    title="Send via email"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-slate-300 transition hover:border-purple-300/30 hover:bg-purple-300/10 hover:text-purple-200 disabled:opacity-40"
                  >
                    <Mail size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteRow(b.name)}
                    disabled={busy === b.name}
                    title="Delete"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-slate-300 transition hover:border-rose-300/30 hover:bg-rose-300/10 hover:text-rose-200 disabled:opacity-40"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 text-[11px] text-slate-400">
          <span>
            Page {page + 1} / {totalPages} · {backups.length} backups
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-md border border-white/10 px-2 py-1 hover:bg-white/[0.04] disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-md border border-white/10 px-2 py-1 hover:bg-white/[0.04] disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatLocal(iso: string): string {
  try {
    return new Date(iso).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
