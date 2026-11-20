"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "Bartenders needed" on the Team tab, admins and managers. Staffing only: it
// never changes the price, the booked total, or the booking, and nothing is
// sent to the client or GHL. The event cards, staffing colors, Team badge and
// open shift posts follow it. Also shows the barback line and the staffing log.

export interface BartendersNeededData {
  value: number | null; // what staffing uses now
  booked: number | null; // the booking's own number (or the estimate)
  setBy: string; // who set it on this tab, "" when nobody did
  setAt: string; // already formatted, "" when nobody did
  estimateNote: string; // "Estimated from 90 guests. Set the right number."
  barbackLine: string; // "" when the package has no barback
  barbackMissing: boolean; // on, and no bar back assigned yet
  log: { at: string; by: string; text: string }[]; // at already formatted, newest first
}

const CHOICES = [1, 2, 3, 4];

export default function BartendersNeeded({ sessionId, data }: { sessionId: string; data: BartendersNeededData }) {
  const router = useRouter();
  const [value, setValue] = useState<number>(data.value ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showLog, setShowLog] = useState(false);

  const save = async (v: number | null) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/admin/staffing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, action: "bartenders", value: v }) });
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
      <p className="text-xs text-[#A39585]">Staffing only. The price and the booking stay the same.</p>
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
