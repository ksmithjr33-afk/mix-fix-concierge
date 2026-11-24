"use client";

import { useState } from "react";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";
const NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The weekdays this person never works. Tap a day to switch it, then save. */
export default function WeekdayForm({ initial }: { initial: number[] }) {
  const [days, setDays] = useState<number[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const changed = days.join(",") !== initial.join(",");

  const toggle = (d: number) => {
    setSaved(false);
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/availability", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekdays: days }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card}>
      <h2 className="font-heading text-lg font-bold text-[#2C2420]">Days I never work</h2>
      <p className="text-sm text-[#6B5D52] mb-3">Pick the weekdays you are never available. You will not get shift texts or offers for events on those days.</p>
      <div className="grid grid-cols-7 gap-1.5">
        {NAMES.map((n, d) => {
          const off = days.includes(d);
          return (
            <button
              key={n}
              type="button"
              aria-pressed={off}
              onClick={() => toggle(d)}
              className={`rounded-lg py-3 text-sm font-medium border ${off ? "bg-[#A0412D] text-white border-[#A0412D]" : "bg-white text-[#2C2420] border-[#DDD5CC]"}`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-[#A39585] mt-2">{days.length ? "Red days are days you never work." : "No weekdays off."}</p>
      <div className="flex items-center gap-3 mt-3">
        <button type="button" disabled={busy || !changed} onClick={save} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
          {busy ? "Saving..." : "Save days"}
        </button>
        {saved && !changed && <span className="text-sm text-[#55684A]">Saved.</span>}
      </div>
      {error && <p className="text-sm text-[#A0412D] mt-2">{error}</p>}
    </section>
  );
}
