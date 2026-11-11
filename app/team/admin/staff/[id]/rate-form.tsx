"use client";

import { useState } from "react";

/** The hourly rate, set by admins. Blank clears it, and no rate means no pay is shown. */
export default function RateForm({ staffId, initial }: { staffId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg("");
        setError("");
        try {
          const res = await fetch("/api/team/admin/pay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staffId, rate: value }) });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(d.error ?? "Could not save.");
          setMsg(d.cents ? "Saved." : "Rate cleared. No pay is shown.");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not save.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex gap-2 items-center">
        <span className="text-[15px] text-[#2C2420]">$</span>
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="No rate"
          aria-label="Hourly rate in dollars"
          className="w-28 rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420]"
        />
        <span className="text-[15px] text-[#6B5D52]">an hour</span>
        <button type="submit" disabled={busy} className="ml-auto rounded-xl bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
      {msg && <p className="text-sm text-[#55684A]">{msg}</p>}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </form>
  );
}
