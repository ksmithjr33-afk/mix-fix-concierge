"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Shown on the event page while an event is offered to this staff member and not yet answered. */
export default function RespondBanner({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"open" | "confirm-decline" | "accepted">("open");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async (response: "accept" | "decline") => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, response }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      if (response === "decline") {
        router.replace("/team/events");
        router.refresh();
      } else setState("accepted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "accepted") {
    return <p className="rounded-2xl bg-[#E4EBDF] text-[#55684A] px-4 py-3 text-[15px] font-medium">You accepted this event. See you there.</p>;
  }
  return (
    <section className="rounded-2xl bg-[#FFF8EC] border border-[#E3C9A0] px-4 py-3 space-y-2">
      <p className="text-[15px] font-medium text-[#2C2420]">You have been offered this event. Can you work it?</p>
      {state === "confirm-decline" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[#2C2420]">Decline this event?</span>
          <button type="button" onClick={() => send("decline")} disabled={busy} className="rounded-lg bg-[#A0412D] text-white px-3 py-2 text-sm font-medium disabled:opacity-40">
            {busy ? "Declining..." : "Yes, decline"}
          </button>
          <button type="button" onClick={() => setState("open")} disabled={busy} className="text-sm text-[#6B5D52] underline">
            Keep it
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => send("accept")} disabled={busy} className="rounded-xl bg-[#8B9E7E] text-white py-2.5 font-medium disabled:opacity-40">
            {busy ? "Saving..." : "Accept"}
          </button>
          <button type="button" onClick={() => setState("confirm-decline")} disabled={busy} className="rounded-xl border border-[#A39585] text-[#6B5D52] py-2.5 font-medium disabled:opacity-40">
            Decline
          </button>
        </div>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}
