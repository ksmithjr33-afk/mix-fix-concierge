"use client";

import { useState } from "react";

/** The named teammate accepts or declines taking the shift. */
export default function Answer({ handoffId }: { handoffId: string }) {
  const [done, setDone] = useState<"" | "accept" | "decline">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async (action: "accept" | "decline") => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, handoffId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setDone(action);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  if (done === "accept") return <p className="rounded-2xl bg-[#E4EBDF] text-[#55684A] px-4 py-3 text-[15px] font-medium">Thanks. An admin will approve it, then you get a text with the event page.</p>;
  if (done === "decline") return <p className="rounded-2xl bg-[#F5F0EB] text-[#6B5D52] px-4 py-3 text-[15px]">Got it. We let them know.</p>;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} onClick={() => send("accept")} className="rounded-xl bg-[#8B9E7E] text-white py-2.5 font-medium disabled:opacity-40">
          Accept
        </button>
        <button type="button" disabled={busy} onClick={() => send("decline")} className="rounded-xl border border-[#A39585] text-[#6B5D52] py-2.5 font-medium disabled:opacity-40">
          Decline
        </button>
      </div>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </div>
  );
}
