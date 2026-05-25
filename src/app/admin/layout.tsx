"use client";
import { useState } from "react";
import { Sidebar, adminNav } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <Sidebar items={adminNav} open={open} onClose={() => setOpen(false)} />
      <div className="flex min-h-screen flex-1 flex-col">
        <Topbar onToggleSidebar={() => setOpen(true)} showSync />
        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
