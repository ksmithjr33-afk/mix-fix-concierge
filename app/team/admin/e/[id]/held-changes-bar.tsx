"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { HeldSummary } from "@/lib/team/held-changes";
import { barText, TIME_PLACE_LINE } from "@/lib/team/held-changes";

/**
 * "3 changes not sent to the team", on every tab of the manager view, with
 * Notify the team (one text listing all of them) and Do not notify. Red, with
 * the time or location line, when the date, service times, or address changed.
 */
export default function HeldChangesBar({ sessionId, summary }: { sessionId: string; summary: HeldSummary }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [open, setOpen] = useState(false);
  if (done) return <p className="rounded-2xl border border-[#DDD5CC] bg-[#E4EBDF] px-4 py-2 text-sm text-[#55684A]" role="status">{done}</p>;
  const run = async (action: "notify" | "skip") => {
    setBusy(action);
    setError("");
    try {
      const res = await fetch("/api/team/admin/held-changes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, action }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setDone(action === "notify" ? `Sent to the team${typeof d.texted === "number" ? ` (${d.texted} ${d.texted === 1 ? "text" : "texts"})` : ""}.` : "Marked as not sent. The team was not texted.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy("");
    }
  };
  const strong = summary.timePlace;
  return (
    <section
      role={strong ? "alert" : "status"}
      data-held-changes
      className={`rounded-2xl px-4 py-3 space-y-2 ${strong ? "border-2 border-[#B3261E] bg-[#FDECEA]" : "border border-[#E3C9A0] bg-[#FFF8EC]"}`}
    >
      <p className={`font-heading font-bold ${strong ? "text-[#8C1D18]" : "text-[#2C2420]"}`}>{barText(summary.count)}</p>
      {strong && <p className="text-[15px] font-medium text-[#8C1D18]">{TIME_PLACE_LINE}</p>}
      <button type="button" onClick={() => setOpen(!open)} className="text-sm text-[#9A7049] underline">
        {open ? "Hide the changes" : "See the changes"}
      </button>
      {open && (
        <ul className="list-disc pl-5 text-sm text-[#2C2420]">
          {summary.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => run("notify")} disabled={!!busy} className="min-h-[44px] rounded-lg bg-[#B5845A] px-4 text-sm font-medium text-white disabled:opacity-40">
          {busy === "notify" ? "Sending..." : "Notify the team"}
        </button>
        <button type="button" onClick={() => run("skip")} disabled={!!busy} className="min-h-[44px] rounded-lg border border-[#2C2420] px-4 text-sm font-medium text-[#2C2420] disabled:opacity-40">
          {busy === "skip" ? "Saving..." : "Do not notify"}
        </button>
      </div>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}
