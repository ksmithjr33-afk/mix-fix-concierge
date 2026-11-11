"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";
const input = "w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2.5 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30";

export default function AvailabilityForm({ today, rows }: { today: string; rows: { id: string; label: string; note: string; started: boolean }[] }) {
  const router = useRouter();
  const [range, setRange] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const send = async (method: "POST" | "DELETE", body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setError("");
    setSaved("");
    setWarnings([]);
    try {
      const res = await fetch("/api/team/availability", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      if (method === "POST") {
        setStart("");
        setEnd("");
        setNote("");
        setSaved("Saved.");
        setWarnings(Array.isArray(d.warnings) ? d.warnings : []);
      } else setSaved("Removed.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-3">
      <section className={card}>
        <h2 className="font-heading text-base font-bold text-[#2C2420] mb-2">Mark days unavailable</h2>
        <div className="inline-flex gap-1 bg-[#DDD5CC] p-1 rounded-lg mb-3" role="group" aria-label="Single date or range">
          {[false, true].map((r) => (
            <button key={String(r)} type="button" onClick={() => setRange(r)} className={`px-3 py-1 rounded-md text-sm font-medium ${range === r ? "bg-[#F5F0EB] text-[#2C2420] shadow-sm" : "text-[#6B5D52]"}`}>
              {r ? "Date range" : "Single date"}
            </button>
          ))}
        </div>
        <div className={`grid gap-2 ${range ? "sm:grid-cols-2" : ""}`}>
          <label className="block text-sm text-[#6B5D52]">
            {range ? "From" : "Date"}
            <input type="date" min={today} value={start} onChange={(e) => setStart(e.target.value)} className={input} />
          </label>
          {range && (
            <label className="block text-sm text-[#6B5D52]">
              To
              <input type="date" min={start || today} value={end} onChange={(e) => setEnd(e.target.value)} className={input} />
            </label>
          )}
        </div>
        <label className="block text-sm text-[#6B5D52] mt-2">
          Note (optional)
          <input type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Out of town" className={input} />
        </label>
        <button
          type="button"
          disabled={!!busy || !start || (range && !end)}
          onClick={() => send("POST", { start, end: range ? end : start, note }, "add")}
          className="mt-3 rounded-xl bg-[#B5845A] text-white px-4 py-2.5 font-medium disabled:opacity-40"
        >
          {busy === "add" ? "Saving..." : "Save"}
        </button>
        {saved && <p className="text-sm text-[#55684A] mt-2">{saved}</p>}
        {warnings.map((w) => (
          <p key={w} className="text-sm text-[#9A7049] bg-[#FFF3DF] border border-[#E8C9A8] rounded-xl px-3 py-2 mt-2">
            {w}
          </p>
        ))}
        {error && <p className="text-sm text-[#A0412D] mt-2">{error}</p>}
      </section>

      <section className={card}>
        <h2 className="font-heading text-base font-bold text-[#2C2420] mb-2">Your unavailable days</h2>
        {rows.length === 0 ? (
          <p className="text-[15px] text-[#6B5D52]">None. You are available every day.</p>
        ) : (
          <ul className="divide-y divide-[#DDD5CC]">
            {rows.map((r) => (
              <li key={r.id} className="py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-[#2C2420]">{r.label}</p>
                  {r.note && <p className="text-sm text-[#6B5D52] break-words">{r.note}</p>}
                  {r.started && <p className="text-xs text-[#A39585]">Started already. Removing it keeps the past days.</p>}
                </div>
                <button type="button" disabled={!!busy} onClick={() => send("DELETE", { id: r.id }, r.id)} className="shrink-0 text-sm text-[#A0412D] underline disabled:opacity-40">
                  {busy === r.id ? "Removing..." : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
