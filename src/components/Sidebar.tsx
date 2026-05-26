"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Logo } from "./ui/Logo";
import { LayoutDashboard, Server, Settings } from "lucide-react";

export type NavItem = { href: string; label: string; icon: React.ComponentType<any> };

export const adminNav: NavItem[] = [
  { href: "/admin",          label: "Overview",  icon: LayoutDashboard },
  { href: "/admin/servers",  label: "Servers",   icon: Server },
  { href: "/admin/settings", label: "Settings",  icon: Settings },
];

export function Sidebar({ items, open, onClose }: { items: NavItem[]; open?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden",
          open ? "block" : "hidden",
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 transform border-r border-white/5 bg-bg-soft/80 px-4 py-5 backdrop-blur-xl transition-transform",
          "md:sticky md:top-0 md:h-screen md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-8 px-2">
          <Logo />
        </div>
        <nav className="space-y-1">
          {items.map((it) => {
            const active = pathname === it.href || pathname.startsWith(it.href + "/");
            const Icon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all",
                  active
                    ? "bg-gradient-to-r from-cyan-500/15 to-purple-500/15 text-white shadow-glow-sm border border-cyan-300/20"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-white",
                )}
              >
                <Icon size={18} />
                {it.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto absolute bottom-4 left-4 right-4 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-[11px] text-slate-500">
          <div className="font-semibold text-slate-300">Sontoloyo Monitor</div>
          v1.0 · Realtime VPS health
        </div>
      </aside>
    </>
  );
}
