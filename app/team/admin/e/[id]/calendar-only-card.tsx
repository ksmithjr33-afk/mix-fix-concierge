"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CALENDAR_ONLY_SKIPPED } from "@/lib/calendar-only";

/**
 * The Calendar only card at the bottom of the manager Details tab: exactly
 * what will not happen for this client (from lib/calendar-only.ts, the same
 * list the code checks), and "Turn on client messages" with a confirm, which
 * clears calendar only and sends the normal intake payload once.
 */
export default function CalendarOnlyCard({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const turnOn = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/admin/client-messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border-2 border-[#9FB0C2] bg-[#EEF2F6] px-4 py-3 sm:px-5 sm:py-4 space-y-2" aria-label="Calendar only">
      <h2 className="font-heading text-lg font-bold text-[#2C2420]">Calendar only</h2>
      <p className="text-[15px] text-[#2C2420]">This event was added to our calendar only. For this client:</p>
      <ul className="list-disc pl-5 text-[15px] text-[#2C2420] space-y-0.5">
        {CALENDAR_ONLY_SKIPPED.map((s) => (
          <li key={s.key}>{s.label}</li>
        ))}
      </ul>
      <p className="text-sm text-[#6B5D52]">The team side works as normal: staffing, texts to staff, Tools, Supplies, ice, menu pickup, chat, clock and wrap up.</p>
      {confirming ? (
        <div className="rounded-xl border border-[#E3C9A0] bg-[#FFF8EC] px-3 py-3 space-y-2">
          <p className="text-[15px] text-[#2C2420]">Turn on client messages? This sends the booking to GHL now, and from then on the client gets the normal automated texts and emails, change orders, balance reminders and the follow up.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={turnOn} disabled={busy} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-[15px] font-medium disabled:opacity-40">
              {busy ? "Turning on..." : "Yes, turn on client messages"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="rounded-lg border-2 border-[#B5845A] text-[#9A7049] px-4 py-2 text-[15px] font-medium disabled:opacity-40">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="rounded-lg border-2 border-[#B5845A] bg-white text-[#9A7049] px-4 py-2 text-[15px] font-medium">
          Turn on client messages
        </button>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}
