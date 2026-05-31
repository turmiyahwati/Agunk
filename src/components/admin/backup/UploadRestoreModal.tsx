"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Upload, FileCheck2, AlertTriangle, Lock, Eye } from "lucide-react";
import toast from "react-hot-toast";

type Stage = "idle" | "validated" | "restoring" | "done";

/**
 * Two-step Upload & Restore modal.
 *
 * Step 1 (idle → validated): admin selects a file and optional
 *   passphrase, the server validates the archive (path traversal +
 *   manifest extraction + size cap) and returns a manifest preview.
 *   Nothing has been applied to the server state yet.
 *
 * Step 2 (validated → restoring): admin types "RESTORE" to confirm
 *   and clicks Apply. The server runs scripts/restore.sh which makes
 *   `*.before-restore.<TS>` snapshots before swapping any file. This
 *   gives the operator a safety net if the restored backup turns
 *   out to be corrupt or wrong.
 */
export function UploadRestoreModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [validateResult, setValidateResult] = useState<{
    sessionId: string;
    fileName: string;
    encrypted: boolean;
    size: number;
    manifest: Record<string, unknown> | null;
  } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [restoreOutput, setRestoreOutput] = useState("");

  function reset() {
    setStage("idle");
    setFile(null);
    setPassphrase("");
    setValidateResult(null);
    setConfirmText("");
    setRestoreOutput("");
  }

  async function validate() {
    if (!file) {
      toast.error("Pick a file first");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      toast.error("File exceeds 100 MB limit");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (passphrase) fd.append("passphrase", passphrase);
      const res = await fetch("/api/backup/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Validation failed");
      setValidateResult(j);
      setStage("validated");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applyRestore() {
    if (!validateResult || confirmText !== "RESTORE") return;
    setStage("restoring");
    setBusy(true);
    try {
      const res = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: validateResult.sessionId,
          passphrase: passphrase || undefined,
          confirm: "RESTORE",
        }),
      });
      const j = await res.json();
      setRestoreOutput(j.output || "");
      if (!res.ok || !j.ok) {
        toast.error(j.error || "Restore failed");
        setStage("validated");
        return;
      }
      toast.success("Restore applied. Reloading…");
      setStage("done");
      onDone();
      // Brief delay so the admin sees the success state, then dismiss.
      setTimeout(() => {
        reset();
        onClose();
      }, 2500);
    } catch (err) {
      toast.error((err as Error).message);
      setStage("validated");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (busy) return;
        reset();
        onClose();
      }}
      title="Upload & Restore Backup"
      size="lg"
    >
      {stage === "idle" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-3 text-[12px] text-amber-200">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div>
                Restore overwrites your live database, .env, uploads, and SSL cert.
                Existing files are saved as <code>*.before-restore.&lt;TS&gt;</code>{" "}
                so a rollback is possible.
              </div>
            </div>
          </div>

          <Field label="Backup file (.tar.gz or .tar.gz.enc, max 100 MB)">
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-white/15 bg-white/[0.02] px-3 py-3 hover:bg-white/[0.04]">
              <Upload size={16} className="text-cyan-300" />
              <span className="text-sm text-slate-300 truncate">
                {file ? `${file.name} · ${formatBytes(file.size)}` : "Click to choose…"}
              </span>
              <input
                type="file"
                className="hidden"
                accept=".gz,.enc,application/gzip,application/octet-stream"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </Field>

          <Field label="Decryption passphrase (only for .enc archives)" hint="Leave empty for plain .tar.gz files.">
            <input
              type="password"
              className="input"
              autoComplete="off"
              placeholder="••••••••••••"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                reset();
                onClose();
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={validate}
              disabled={busy || !file}
            >
              {busy ? "Validating…" : "Validate & Preview"}
            </button>
          </div>
        </div>
      )}

      {stage === "validated" && validateResult && (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.04] p-3 text-[12px] text-emerald-200">
            <div className="flex items-center gap-2">
              <FileCheck2 size={14} />
              <span>Archive validated. Review the manifest below before applying.</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <ManifestField label="File" value={validateResult.fileName} mono />
            <ManifestField label="Size" value={formatBytes(validateResult.size)} />
            <ManifestField
              label="Encrypted"
              value={validateResult.encrypted ? "AES-256-CBC" : "no"}
              tone={validateResult.encrypted ? "good" : "warn"}
            />
            {validateResult.manifest && typeof validateResult.manifest === "object" && (
              <>
                {(["created_at", "host", "git_commit", "package_version"] as const).map((k) => {
                  const v = (validateResult.manifest as Record<string, unknown>)[k];
                  if (typeof v !== "string") return null;
                  return <ManifestField key={k} label={k.replace(/_/g, " ")} value={v} mono />;
                })}
              </>
            )}
          </div>

          <details className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[11px] text-slate-400">
            <summary className="cursor-pointer text-slate-300 inline-flex items-center gap-1">
              <Eye size={12} /> Raw manifest
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify(validateResult.manifest, null, 2)}
            </pre>
          </details>

          <Field label="Type RESTORE to confirm" hint="Case-sensitive, exactly the word RESTORE.">
            <input
              className="input font-mono"
              autoComplete="off"
              placeholder="RESTORE"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={reset}
              disabled={busy}
            >
              Back
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={applyRestore}
              disabled={busy || confirmText !== "RESTORE"}
            >
              {busy ? "Restoring…" : "Apply Restore"}
            </button>
          </div>
        </div>
      )}

      {stage === "restoring" && (
        <div className="py-8 text-center text-sm text-slate-300">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-cyan-300/40 border-t-cyan-300" />
          Applying restore… do not close this window.
        </div>
      )}

      {stage === "done" && (
        <div className="space-y-3 text-sm text-slate-300">
          <div className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 p-4 text-emerald-200">
            <div className="flex items-center gap-2 font-semibold">
              <Lock size={14} /> Restore complete
            </div>
            <div className="mt-1 text-[12px]">
              Reload the dashboard with the original admin password (sessions were
              invalidated by the .env swap).
            </div>
          </div>
          {restoreOutput && (
            <details className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[11px] text-slate-400">
              <summary className="cursor-pointer text-slate-300">Restore output</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">
                {restoreOutput}
              </pre>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function ManifestField({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "good" | "warn";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-200"
      : tone === "warn"
      ? "text-amber-200"
      : "text-slate-200";
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] p-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`${mono ? "font-mono text-[11px]" : ""} ${toneClass} truncate`}>
        {value}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
