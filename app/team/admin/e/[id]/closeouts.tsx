"use client";

import { useState } from "react";
import type { CloseoutView } from "@/lib/team/closeout-db";
import { timeLabel } from "@/lib/team/clock-label";
import { CloseoutSummary } from "../../../e/[id]/closeout-card";

// The Wrap up section of the Day of tab: each bartender's wrap up, read at a
// glance (Missing or Damaged first in red, then what can be reused, what was
// opened, and Used up collapsed), with earlier saves and Mark reviewed.
// Marking it reviewed locks it for the bartender.

function One({ sessionId, c: initial, tz }: { sessionId: string; c: CloseoutView; tz?: string }) {
  const [c, setC] = useState(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const review = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/admin/wrapup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, closeoutId: c.id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setC({ ...d.closeout, versions: c.versions });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="space-y-2 border-t border-[#EDE6DF] pt-3 first:border-0 first:pt-0">
      <p className="font-medium text-[#2C2420]">{c.staffFirstName}</p>
      <CloseoutSummary c={c} tz={tz} />
      {!c.reviewedAt && (
        <button type="button" onClick={review} disabled={busy} className="rounded-xl bg-[#2C2420] text-white px-4 py-2.5 text-sm font-medium disabled:opacity-40">
          {busy ? "Saving..." : "Mark reviewed"}
        </button>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      {c.versions.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} className="block text-sm text-[#6B5D52] underline">
            {open ? "Hide earlier versions" : `Earlier versions (${c.versions.length})`}
          </button>
          {open && (
            <ul className="text-sm text-[#6B5D52] space-y-1">
              {c.versions.map((v) => (
                <li key={v.version}>
                  Version {v.version}, {timeLabel(v.at, undefined, tz)}: {v.rating.replace("_", " ")}
                  {v.photoUrl && (
                    <a href={v.photoUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-[#B5845A] underline">
                      photo
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

export default function Closeouts({
  sessionId,
  closeouts,
  waiting = [],
  timeZone,
}: {
  sessionId: string;
  closeouts: CloseoutView[];
  waiting?: { name: string; late: boolean }[]; // accepted bartenders with no wrap up yet
  timeZone?: string;
}) {
  return (
    <section className="bg-white rounded-2xl border border-[#DDD5CC] p-4 space-y-3">
      <h2 className="font-heading text-lg font-bold text-[#2C2420]">Wrap up{closeouts.length > 1 ? `s (${closeouts.length})` : ""}</h2>
      {waiting.length > 0 && (
        <ul className="space-y-0.5">
          {waiting.map((w) => (
            <li key={w.name} className={`text-sm ${w.late ? "text-[#A0412D] font-medium" : "text-[#6B5D52]"}`}>
              {w.name}: not in yet{w.late ? ", 2 hours after service ended" : ""}
            </li>
          ))}
        </ul>
      )}
      {closeouts.length === 0 && waiting.length === 0 && <p className="text-[15px] text-[#6B5D52]">No wrap ups yet.</p>}
      <ul className="space-y-3">
        {closeouts.map((c) => (
          <One key={c.id} sessionId={sessionId} c={c} tz={timeZone} />
        ))}
      </ul>
    </section>
  );
}
