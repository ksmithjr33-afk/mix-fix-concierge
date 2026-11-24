"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "Bartenders needed" on the Team tab, admins and managers. Staffing only: it
// never changes the price, the booked total, or the booking, and nothing is
// sent to the client or GHL. The event cards, staffing colors, Team badge and
// open shift posts follow it. Also Barbacks, Event helpers and Servers needed
// (staffing only too: ranked offers and open shifts fill Bartender spots only,
// these are assigned by hand), the barback line and the staffing log.

export interface BartendersNeededData {
  value: number | null; // what staffing uses now
  booked: number | null; // the booking's own number (or the estimate)
  setBy: string; // who set it on this tab, "" when nobody did
  setAt: string; // already formatted, "" when nobody did
  estimateNote: string; // "Estimated from 90 guests. Set the right number."
  barbackLine: string; // "" when the package has no barback
  barbackMissing: boolean; // on, and nobody holds the Barback role on this event yet
  roles: { role: string; label: string; value: number; assigned: number; stillNeeded: number }[]; // Barbacks, Event helpers, Servers needed
  log: { at: string; by: string; text: string }[]; // at already formatted, newest first
}

const CHOICES = [1, 2, 3, 4];
const ROLE_CHOICES = [0, 1, 2, 3, 4];

export default function BartendersNeeded({ sessionId, data }: { sessionId: string; data: BartendersNeededData }) {
  const router = useRouter();
  const [value, setValue] = useState<number>(data.value ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showLog, setShowLog] = useState(false);

  const save = async (v: number | null, role?: string) => {
    setBusy(true);
    setError("");
    try {
      const body = role ? { sessionId, action: "role_needed", role, value: v } : { sessionId, action: "bartenders", value: v };
      const res = await fetch("/api/team/admin/staffing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3 space-y-2" aria-label="Staffing" data-bartenders-needed>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor="bartenders-needed" className="text-[15px] font-medium text-[#2C2420]">
          Bartenders needed
        </label>
        <select
          id="bartenders-needed"
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          disabled={busy}
          className="rounded-lg border border-[#DDD5CC] bg-white px-3 py-1.5 text-[15px] text-[#2C2420]"
        >
          {CHOICES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => save(value)}
          disabled={busy || (value === data.value && !data.estimateNote)}
          className="rounded-lg bg-[#2C2420] text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
      {data.estimateNote && <p className="text-sm font-medium text-[#8A4B12]" data-estimate-note>{data.estimateNote}</p>}
      {data.setBy && (
        <p className="text-sm text-[#6B5D52]">
          Set by {data.setBy}
          {data.setAt ? ` on ${data.setAt}` : ""}. The booking says {data.booked ?? "nothing"}.{" "}
          <button type="button" onClick={() => save(null)} disabled={busy} className="underline text-[#9A7049] disabled:opacity-40">
            Use the booking&apos;s number
          </button>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-role-needed>
        {data.roles.map((r) => (
          <label key={r.role} className="flex items-center gap-2 text-[15px] text-[#2C2420]">
            {r.label}
            <select
              value={r.value}
              onChange={(e) => save(Number(e.target.value), r.role)}
              disabled={busy}
              aria-label={r.label}
              className="rounded-lg border border-[#DDD5CC] bg-white px-2 py-1 text-[15px] text-[#2C2420]"
            >
              {ROLE_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            {r.stillNeeded > 0 && <span className="text-sm text-[#A0412D]">{r.stillNeeded} still needed</span>}
          </label>
        ))}
      </div>
      <p className="text-xs text-[#A39585]">Staffing only. The price and the booking stay the same. Ranked offers fill Bartender spots only; assign other roles by hand.</p>
      {data.barbackLine && (
        <p className="text-[15px] text-[#2C2420]" data-barback-line>
          {data.barbackLine}
          {data.barbackMissing && <span className="text-[#A0412D]"> · no bar back assigned yet</span>}
        </p>
      )}
      {data.log.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowLog((s) => !s)} className="text-sm text-[#9A7049] underline">
            {showLog ? "Hide staffing changes" : `Staffing changes (${data.log.length})`}
          </button>
          {showLog && (
            <ul className="mt-1 space-y-0.5 text-sm text-[#6B5D52]">
              {data.log.map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  {e.at}: {e.text}, by {e.by}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}
