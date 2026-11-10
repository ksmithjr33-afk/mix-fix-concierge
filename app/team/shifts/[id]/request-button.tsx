"use client";

import { useState } from "react";

/** Request this shift, or withdraw. Overlapping another event warns but is allowed. */
export default function RequestButton({ postId, initial, overlaps }: { postId: string; initial: string | null; overlaps: boolean }) {
  const [status, setStatus] = useState(initial === "requested" ? "requested" : "none");
  const [confirmOverlap, setConfirmOverlap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async (action: "request" | "withdraw") => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/shifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, postId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setStatus(action === "request" ? "requested" : "none");
      setConfirmOverlap(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {status === "requested" ? (
        <>
          <p className="rounded-2xl bg-[#E4EBDF] text-[#55684A] px-4 py-3 text-[15px] font-medium">You requested this shift. We will text you if you get it.</p>
          <button type="button" disabled={busy} onClick={() => send("withdraw")} className="text-sm text-[#A0412D] underline disabled:opacity-40">
            {busy ? "Withdrawing..." : "Withdraw my request"}
          </button>
        </>
      ) : confirmOverlap ? (
        <div className="rounded-2xl bg-[#FFF8EC] border border-[#E3C9A0] px-4 py-3 space-y-2">
          <p className="text-[15px] text-[#2C2420]">This shift overlaps another event you are on. Request it anyway?</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => send("request")} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
              {busy ? "Requesting..." : "Request anyway"}
            </button>
            <button type="button" onClick={() => setConfirmOverlap(false)} className="text-sm text-[#6B5D52] underline px-2">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => (overlaps ? setConfirmOverlap(true) : send("request"))}
          className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40"
        >
          {busy ? "Requesting..." : "Request this shift"}
        </button>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </div>
  );
}
