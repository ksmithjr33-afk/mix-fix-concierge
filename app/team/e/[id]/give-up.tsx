"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MyHandoff } from "@/lib/team/shifts-db";

export interface GiveUpProps {
  sessionId: string;
  handoff: MyHandoff | null;
  teammates: { id: string; name: string }[];
  canStart: boolean; // accepted and not clocked in
}

async function call(body: Record<string, unknown>) {
  const res = await fetch("/api/team/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error ?? "Could not save.");
}

/** "Give up this shift", and while a handoff is open, its status. The bartender stays on the shift until an admin approves. */
export default function GiveUp({ sessionId, handoff, teammates, canStart }: GiveUpProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"teammate" | "market">(teammates.length ? "teammate" : "market");
  const [teammateId, setTeammateId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      await call(body);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  if (handoff) {
    const first = handoff.teammateName.split(" ")[0];
    return (
      <section className="rounded-2xl bg-[#FFF8EC] border border-[#E3C9A0] px-4 py-3 space-y-2">
        <p className="text-[15px] font-medium text-[#2C2420]">You asked to give up this shift.</p>
        <p className="text-sm text-[#6B5D52]">
          {handoff.mode === "teammate"
            ? handoff.status === "asked"
              ? `Waiting for ${first || "your teammate"} to answer.`
              : `${first || "Your teammate"} accepted. Waiting for an admin to approve.`
            : `Open to the market. ${handoff.requests} ${handoff.requests === 1 ? "person has" : "people have"} asked so far. An admin picks the replacement.`}
        </p>
        <p className="text-sm font-medium text-[#A0412D]">Until an admin approves a replacement, you are still on this shift and responsible for it.</p>
        <button type="button" disabled={busy} onClick={() => run({ action: "cancel", handoffId: handoff.id })} className="text-sm text-[#6B5D52] underline disabled:opacity-40">
          {busy ? "Cancelling..." : "Cancel my request and keep the shift"}
        </button>
        {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      </section>
    );
  }
  if (!canStart) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-[#A0412D] underline px-1">
        Give up this shift
      </button>
    );
  }
  return (
    <section className="rounded-2xl bg-[#F5F0EB] border border-[#DDD5CC] px-4 py-3 space-y-3">
      <h2 className="font-heading text-base font-bold text-[#2C2420]">Give up this shift</h2>
      <label className="block text-xs text-[#A39585] uppercase tracking-wide">
        Reason (required)
        <textarea
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Family emergency"
          className="mt-1 w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420] resize-none"
        />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-xs text-[#A39585] uppercase tracking-wide mb-1">Who should take it?</legend>
        <label className={`flex items-start gap-2 text-[15px] text-[#2C2420] ${teammates.length ? "" : "opacity-50"}`}>
          <input type="radio" name="mode" className="mt-1" disabled={!teammates.length} checked={mode === "teammate"} onChange={() => setMode("teammate")} />
          <span>
            A teammate I name
            <span className="block text-xs text-[#6B5D52]">{teammates.length ? "They get a text to accept or decline." : "Nobody else in this market is free for it."}</span>
          </span>
        </label>
        {mode === "teammate" && teammates.length > 0 && (
          <select value={teammateId} onChange={(e) => setTeammateId(e.target.value)} aria-label="Teammate" className="w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2.5 text-[16px] text-[#2C2420]">
            <option value="">Choose a teammate</option>
            {teammates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-start gap-2 text-[15px] text-[#2C2420]">
          <input type="radio" name="mode" className="mt-1" checked={mode === "market"} onChange={() => setMode("market")} />
          <span>
            Open it to the market
            <span className="block text-xs text-[#6B5D52]">Posted as &ldquo;Cover needed&rdquo;. Bartenders in this market can request it.</span>
          </span>
        </label>
      </fieldset>
      <p className="text-sm text-[#6B5D52]">An admin approves the replacement. Until then you are still on the shift.</p>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || reason.trim().length < 3 || (mode === "teammate" && !teammateId)}
          onClick={() => run({ action: "start", sessionId, mode, reason, teammateId: mode === "teammate" ? teammateId : undefined })}
          className="rounded-lg bg-[#A0412D] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Sending..." : "Send request"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-[#6B5D52] underline px-2">
          Keep the shift
        </button>
      </div>
    </section>
  );
}
