"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { LogIn, Loader2, ArrowLeft } from "lucide-react";
import toast from "react-hot-toast";
import { Logo } from "@/components/ui/Logo";

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      toast.error("Email atau password salah");
      return;
    }
    toast.success("Login berhasil");
    const callbackUrl = sp.get("callbackUrl");
    router.replace(callbackUrl || "/admin");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label">Email Admin</label>
        <input
          className="input"
          type="email"
          required
          placeholder="admin@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
        />
      </div>
      <div>
        <label className="label">Password</label>
        <input
          className="input"
          type="password"
          required
          minLength={6}
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
        Masuk Admin
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="relative grid min-h-screen place-items-center px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass w-full max-w-md p-8"
      >
        <div className="mb-6 flex flex-col items-center gap-3">
          <Logo size="lg" />
          <p className="text-sm text-slate-400">Akses panel administrator</p>
        </div>
        <Suspense fallback={<div className="h-40" />}>
          <LoginForm />
        </Suspense>
        <div className="mt-6 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-cyan-300"
          >
            <ArrowLeft size={14} /> Kembali ke monitoring publik
          </Link>
        </div>
      </motion.div>
    </main>
  );
}
