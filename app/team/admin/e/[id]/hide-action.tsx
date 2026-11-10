"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setHidden } from "../../events/hidden-list";

/** Hide or unhide this event from the team portal, with a confirm step before hiding. */
export default function HideAction({ sessionId, hidden }: { sessionId: string; hidden: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (next: boolean) => {
    setBusy(true);
    setError("");
    try {
      await setHidden(sessionId, next);
      setConfirming(false);
      if (next) router.push("/team/admin/events");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  if (hidden) {
    return (
      <section className="rounded-2xl bg-[#FFF8EC] border border-[#E3C9A0] px-4 py-3 space-y-2">
        <p className="text-[15px] text-[#2C2420]">This event is hidden from every team list and cannot be assigned.</p>
        <button type="button" onClick={() => run(false)} disabled={busy} className="rounded-xl bg-[#B5845A] text-white px-5 py-2.5 font-medium disabled:opacity-40">
          {busy ? "Unhiding..." : "Unhide this event"}
        </button>
        {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      </section>
    );
  }
  return (
    <section className="px-1 pt-2 space-y-2">
      {confirming ? (
        <div className="rounded-2xl bg-[#F5F0EB] border border-[#DDD5CC] px-4 py-3 space-y-2">
          <p className="text-[15px] text-[#2C2420]">Hide this event from the team portal? Nothing is deleted, the client is not affected, and you can unhide it from Hidden events.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => run(true)} disabled={busy} className="rounded-lg bg-[#A0412D] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
              {busy ? "Hiding..." : "Yes, hide it"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="text-sm text-[#6B5D52] underline px-2">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="text-sm text-[#A0412D] underline">
          Hide this event
        </button>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}
