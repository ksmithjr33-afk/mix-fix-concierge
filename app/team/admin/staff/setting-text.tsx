"use client";

import { useState } from "react";

/** A team setting that is a line of wording (like the ice rule). Empty puts the default back. */
export default function SettingText({ settingKey, initial, title, help, max = 200 }: { settingKey: string; initial: string; title: string; help: string; max?: number }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: settingKey, text: value }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setValue(d.value);
      setSaved(d.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 space-y-2">
      <label className="block">
        <span className="block font-heading font-bold text-[#2C2420]">{title}</span>
        <span className="block text-sm text-[#6B5D52]">{help}</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={max}
          className="mt-2 w-full rounded-lg border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]"
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy || value.trim() === saved} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
          {busy ? "Saving..." : "Save"}
        </button>
        {error && <span className="text-sm text-[#A0412D]">{error}</span>}
      </div>
    </section>
  );
}
