"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ShieldCheck, ShieldOff } from "lucide-react";
import toast from "react-hot-toast";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";

type User = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  active: boolean;
  createdAt: string;
};

export default function ManageMembers() {
  const [rows, setRows] = useState<User[] | null>(null);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<User | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/members", { cache: "no-store" });
    const j = await r.json();
    if (r.ok) setRows(j.users);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(form: any) {
    const url = edit ? `/api/members/${edit.id}` : "/api/members";
    const method = edit ? "PATCH" : "POST";
    const body: any = { ...form };
    if (edit && !body.password) delete body.password;
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) { toast.error(j.error || "Save failed"); return; }
    toast.success(edit ? "Member updated" : "Member created");
    setOpen(false); setEdit(null); load();
  }

  async function toggleActive(u: User) {
    const res = await fetch(`/api/members/${u.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !u.active }),
    });
    if (res.ok) { toast.success(u.active ? "Deactivated" : "Activated"); load(); }
  }

  async function remove(u: User) {
    if (!confirm(`Hapus member "${u.email}"?`)) return;
    const res = await fetch(`/api/members/${u.id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(j.error || "Delete failed"); return; }
    toast.success("Deleted"); load();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Manage <span className="neon-text">Members</span></h1>
          <p className="text-sm text-slate-400">Akun member yang bisa melihat dashboard.</p>
        </div>
        <button onClick={() => { setEdit(null); setOpen(true); }} className="btn-primary">
          <Plus size={16} /> Tambah User
        </button>
      </div>

      <div className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-white/5 text-left text-[11px] uppercase tracking-wider text-slate-400">
                <th className="table-cell">Name</th>
                <th className="table-cell">Email</th>
                <th className="table-cell">Role</th>
                <th className="table-cell">Active</th>
                <th className="table-cell">Created</th>
                <th className="table-cell text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!rows ? Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-white/5"><td className="table-cell" colSpan={6}><Skeleton className="h-6 w-full" /></td></tr>
              )) : rows.length === 0 ? (
                <tr><td className="table-cell text-center text-slate-400" colSpan={6}>Belum ada user.</td></tr>
              ) : rows.map((u) => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="table-cell font-medium text-white">{u.name}</td>
                  <td className="table-cell font-mono text-xs">{u.email}</td>
                  <td className="table-cell">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${u.role === "ADMIN" ? "border-purple-400/30 bg-purple-400/10 text-purple-300" : "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="table-cell">
                    <span className={`text-xs ${u.active ? "text-emerald-300" : "text-rose-300"}`}>{u.active ? "Active" : "Inactive"}</span>
                  </td>
                  <td className="table-cell text-xs text-slate-400">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="table-cell">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => toggleActive(u)} title="Toggle active"
                        className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5">
                        {u.active ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
                      </button>
                      <button onClick={() => { setEdit(u); setOpen(true); }} title="Edit"
                        className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => remove(u)} title="Delete"
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

      <Modal open={open} onClose={() => { setOpen(false); setEdit(null); }} title={edit ? "Edit User" : "Tambah User"}>
        <MemberForm initial={edit} onSubmit={save} onCancel={() => { setOpen(false); setEdit(null); }} />
      </Modal>
    </div>
  );
}

function MemberForm({ initial, onSubmit, onCancel }: { initial: User | null; onSubmit: (v: any) => void; onCancel: () => void }) {
  const [name, setName]       = useState(initial?.name ?? "");
  const [email, setEmail]     = useState(initial?.email ?? "");
  const [password, setPass]   = useState("");
  const [role, setRole]       = useState<"ADMIN" | "MEMBER">(initial?.role ?? "MEMBER");
  const [active, setActive]   = useState<boolean>(initial?.active ?? true);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit({ name, email, password, role, active }); }}
      className="space-y-3"
    >
      <div><label className="label">Nama</label>
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label className="label">Email</label>
        <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div><label className="label">Password {initial && <span className="text-slate-500">(kosongkan = jangan ubah)</span>}</label>
        <input className="input" type="password" minLength={6} value={password} required={!initial} onChange={(e) => setPass(e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as any)}>
            <option value="MEMBER">MEMBER</option>
            <option value="ADMIN">ADMIN</option>
          </select></div>
        <div><label className="label">Aktif</label>
          <label className="mt-2 inline-flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span className="text-sm">{active ? "Active" : "Inactive"}</span>
          </label></div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>Batal</button>
        <button type="submit" className="btn-primary">Simpan</button>
      </div>
    </form>
  );
}
