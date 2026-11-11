"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Approve, or reject with a note, one pending certification. */
export default function CertReview({ id }: { id: string }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const send = async (decision: "approve" | "reject") => {
    setBusy(decision);
    setError("");
    try {
      const res = await fetch("/api/team/admin/certs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review", id, decision, note }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="mt-2 space-y-2">
      {rejecting ? (
        <>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why, for the bartender (required)" className="w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 text-[16px]" />
          <div className="flex gap-2">
            <button type="button" disabled={!!busy} onClick={() => send("reject")} className="rounded-lg bg-[#A0412D] text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40">
              {busy === "reject" ? "Saving..." : "Reject"}
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="text-sm text-[#6B5D52] underline px-2">
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="flex gap-2">
          <button type="button" disabled={!!busy} onClick={() => send("approve")} className="rounded-lg bg-[#8B9E7E] text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40">
            {busy === "approve" ? "Approving..." : "Approve"}
          </button>
          <button type="button" disabled={!!busy} onClick={() => setRejecting(true)} className="rounded-lg border border-[#A0412D] text-[#A0412D] px-3 py-1.5 text-sm font-medium disabled:opacity-40">
            Reject
          </button>
        </div>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </div>
  );
}
