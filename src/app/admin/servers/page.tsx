"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Search, Wifi, RefreshCcw, Power } from "lucide-react";
import toast from "react-hot-toast";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { ServerForm, type ServerFormValues } from "@/components/admin/ServerForm";

type Row = ServerFormValues & {
  id: string;
  status: "ONLINE" | "OFFLINE" | "FULL" | "WARNING" | "UNKNOWN";
  activeUsers: number;
  speedMbps: number;
  rxBytes: number;
  txBytes: number;
  lastSyncAt?: string | null;
  lastError?: string | null;
};

export default function ManageServers() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Row | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/servers", { cache: "no-store" });
    const j = await r.json();
    if (r.ok) setRows(j.servers);
    else toast.error(j.error || "Load failed");
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(values: ServerFormValues) {
    const url  = edit ? `/api/servers/${edit.id}` : "/api/servers";
    const method = edit ? "PATCH" : "POST";
    const res = await fetch(url, {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(values),
    });
    const j = await res.json();
    if (!res.ok) { toast.error(j.error || "Save failed"); return; }
    toast.success(edit ? "Server updated" : "Server created");
    setOpen(false); setEdit(null); load();
  }

  async function remove(r: Row) {
    if (!confirm(`Hapus server "${r.name}"?`)) return;
    const res = await fetch(`/api/servers/${r.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Delete failed"); return; }
    toast.success("Server deleted"); load();
  }

  async function testConn(r: Row) {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/servers/${r.id}/test`, { method: "POST" });
      const j = await res.json();
      if (j.ok) toast.success("Agent reachable · synced");
      else toast.error(`Agent error: ${j.error}`);
    } finally {
      setBusy(null);
      load();
    }
  }

  async function toggle(r: Row) {
    const res = await fetch(`/api/servers/${r.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !r.enabled }),
    });
    if (res.ok) { toast.success(r.enabled ? "Disabled" : "Enabled"); load(); }
  }

  const filtered = (rows || []).filter((r) =>
    !q || `${r.name} ${r.domain} ${r.countryName} ${r.provider}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Manage <span className="neon-text">Servers</span></h1>
          <p className="text-sm text-slate-400">CRUD lengkap server VPN/Xray + test koneksi agent.</p>
        </div>
        <button onClick={() => { setEdit(null); setOpen(true); }} className="btn-primary">
          <Plus size={16} /> Tambah Server
        </button>
      </div>

      <div className="glass p-3">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-9" placeholder="Cari nama / domain / provider..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-white/5 text-left text-[11px] uppercase tracking-wider text-slate-400">
                <th className="table-cell">Name</th>
                <th className="table-cell">Location</th>
                <th className="table-cell">Domain</th>
                <th className="table-cell">Slot</th>
                <th className="table-cell">Status</th>
                <th className="table-cell">Last Sync</th>
                <th className="table-cell text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!rows ? Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="table-cell" colSpan={7}><Skeleton className="h-6 w-full" /></td>
                </tr>
              )) : filtered.length === 0 ? (
                <tr><td className="table-cell text-center text-slate-400" colSpan={7}>Belum ada server. Klik "Tambah Server".</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id} className="border-b border-white/5 transition-colors hover:bg-white/[0.02]">
                  <td className="table-cell">
                    <div className="font-medium text-white">{r.name}</div>
                    <div className="text-xs text-slate-500">{r.provider}</div>
                  </td>
                  <td className="table-cell">{r.countryName} <span className="text-slate-500">({r.country})</span></td>
                  <td className="table-cell font-mono text-xs">{r.domain}</td>
                  <td className="table-cell">{r.activeUsers}/{r.maxSlot}</td>
                  <td className="table-cell"><StatusBadge status={r.status} /></td>
                  <td className="table-cell text-xs text-slate-400">
                    {r.lastSyncAt ? new Date(r.lastSyncAt).toLocaleTimeString() : "—"}
                    {r.lastError && <div className="text-rose-400">{r.lastError}</div>}
                  </td>
                  <td className="table-cell">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => testConn(r)} disabled={busy === r.id} title="Test API"
                        className="rounded-lg border border-white/10 p-2 text-cyan-300 hover:bg-cyan-500/10">
                        {busy === r.id ? <RefreshCcw size={14} className="animate-spin" /> : <Wifi size={14} />}
                      </button>
                      <button onClick={() => toggle(r)} title={r.enabled ? "Disable" : "Enable"}
                        className={`rounded-lg border border-white/10 p-2 ${r.enabled ? "text-emerald-300 hover:bg-emerald-500/10" : "text-slate-500 hover:bg-white/5"}`}>
                        <Power size={14} />
                      </button>
                      <button onClick={() => { setEdit(r); setOpen(true); }} title="Edit"
                        className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => remove(r)} title="Delete"
                        className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 text-rose-300 hover:bg-rose-500/15">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => { setOpen(false); setEdit(null); }} title={edit ? "Edit Server" : "Tambah Server"} size="lg">
        <ServerForm initial={edit ?? undefined} onSubmit={save} onCancel={() => { setOpen(false); setEdit(null); }} />
      </Modal>
    </div>
  );
}
