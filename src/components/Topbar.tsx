"use client";
import { signOut, useSession } from "next-auth/react";
import { LogOut, Menu, RefreshCcw } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

export function Topbar({ onToggleSidebar, showSync = false }: { onToggleSidebar?: () => void; showSync?: boolean }) {
  const { data } = useSession();
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    try {
      const res = await fetch("/api/monitor/sync", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Sync failed");
      toast.success(`Synced ${j.ok}/${j.total} server`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/5 bg-bg/70 px-4 py-3 backdrop-blur-xl md:px-6">
      <button onClick={onToggleSidebar} className="rounded-lg p-2 text-slate-300 hover:bg-white/5 md:hidden">
        <Menu size={20} />
      </button>
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        {showSync && (
          <button onClick={sync} disabled={busy} className="btn-ghost text-xs">
            <RefreshCcw size={14} className={busy ? "animate-spin" : ""} />
            Sync now
          </button>
        )}
        <div className="hidden text-right md:block">
          <div className="text-sm font-medium">{data?.user?.name}</div>
          <div className="text-xs text-slate-400">{(data?.user as any)?.role}</div>
        </div>
        <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-cyan-400 to-purple-600 text-sm font-bold text-black">
          {(data?.user?.name || "?").slice(0, 1).toUpperCase()}
        </div>
        <button onClick={() => signOut({ callbackUrl: "/" })} className="rounded-lg p-2 text-slate-300 hover:bg-rose-500/10 hover:text-rose-300">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
