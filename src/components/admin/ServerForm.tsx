"use client";
import { useState } from "react";

export type ServerFormValues = {
  name: string;
  domain: string;
  country: string;
  countryName: string;
  flag?: string | null;
  provider: string;
  apiUrl?: string | null;
  apiKey?: string | null;
  enabled: boolean;
  refreshMs: number;
  maxSlot: number;
  activeUsers?: number;
  pingMs?: number;
  speedMbps?: number;
};

const empty: ServerFormValues = {
  name: "",
  domain: "",
  country: "ID",
  countryName: "Indonesia",
  flag: "",
  provider: "",
  apiUrl: "",
  apiKey: "",
  enabled: true,
  refreshMs: 10000,
  maxSlot: 100,
  activeUsers: 0,
  pingMs: 0,
  speedMbps: 0,
};

export function ServerForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<ServerFormValues>;
  onSubmit: (v: ServerFormValues) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<ServerFormValues>({ ...empty, ...initial } as ServerFormValues);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof ServerFormValues>(k: K, val: ServerFormValues[K]) {
    setV((s) => ({ ...s, [k]: val }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    // Clean empty strings to null on optional URL fields
    const cleaned: ServerFormValues = {
      ...v,
      flag: v.flag ? v.flag : null,
      apiUrl: v.apiUrl ? v.apiUrl : null,
      apiKey: v.apiKey ? v.apiKey : null,
    };
    try { await onSubmit(cleaned); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label="Nama Server" required>
        <input className="input" required value={v.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field label="Provider" required>
        <input className="input" required value={v.provider} onChange={(e) => set("provider", e.target.value)} placeholder="DigitalOcean, Vultr, ..." />
      </Field>
      <Field label="Domain / IP" required>
        <input className="input" required value={v.domain} onChange={(e) => set("domain", e.target.value)} placeholder="sg1.example.com" />
      </Field>
      <Field label="Max Slot" required>
        <input className="input" type="number" min={1} required value={v.maxSlot} onChange={(e) => set("maxSlot", Number(e.target.value))} />
      </Field>

      <Field label="Country code (ISO-2)" required>
        <input className="input" maxLength={3} required value={v.country} onChange={(e) => set("country", e.target.value.toUpperCase())} placeholder="ID" />
      </Field>
      <Field label="Country name" required>
        <input className="input" required value={v.countryName} onChange={(e) => set("countryName", e.target.value)} />
      </Field>

      <Field label="Flag/icon URL (opsional)">
        <input className="input" value={v.flag ?? ""} onChange={(e) => set("flag", e.target.value)} placeholder="https://..." />
      </Field>
      <Field label="Refresh interval (ms)">
        <input className="input" type="number" min={1000} step={500} value={v.refreshMs} onChange={(e) => set("refreshMs", Number(e.target.value))} />
      </Field>

      <Field label="VPS Agent base URL">
        <input className="input" value={v.apiUrl ?? ""} onChange={(e) => set("apiUrl", e.target.value)} placeholder="http://1.2.3.4:8787" />
      </Field>
      <Field label="API Key">
        <input className="input" value={v.apiKey ?? ""} onChange={(e) => set("apiKey", e.target.value)} placeholder="X-API-Key" />
      </Field>

      <Field label="Manual: Active users">
        <input className="input" type="number" min={0} value={v.activeUsers ?? 0} onChange={(e) => set("activeUsers", Number(e.target.value))} />
      </Field>
      <Field label="Manual: Ping (ms)">
        <input className="input" type="number" min={0} value={v.pingMs ?? 0} onChange={(e) => set("pingMs", Number(e.target.value))} />
      </Field>
      <Field label="Manual: Speed (Mb/s)">
        <input className="input" type="number" min={0} value={v.speedMbps ?? 0} onChange={(e) => set("speedMbps", Number(e.target.value))} />
      </Field>

      <Field label="Auto monitor">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={v.enabled} onChange={(e) => set("enabled", e.target.checked)} className="h-4 w-4 accent-cyan-400" />
          <span className="text-sm">{v.enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </Field>

      <div className="md:col-span-2 mt-2 flex items-center justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>Batal</button>
        <button type="submit" disabled={busy} className="btn-primary">{busy ? "Menyimpan..." : "Simpan"}</button>
      </div>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}{required && <span className="text-rose-400"> *</span>}</label>
      {children}
    </div>
  );
}
