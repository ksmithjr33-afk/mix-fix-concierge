"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Manager view, top of Details, admins and managers only: a booking saved with
// "Price needs a check". Shows why, the model it was saved on, and confirms
// the model, which clears the flag. Staff pay on this event is not final while
// the flag shows.
export default function PriceCheckCard({
  sessionId,
  reason,
  model,
  since,
}: {
  sessionId: string;
  reason: string;
  model: "gratuity" | "service_fee";
  since: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const other = model === "service_fee" ? "gratuity" : "service_fee";
  const label = (m: "gratuity" | "service_fee") => (m === "service_fee" ? "Service fee model" : "Gratuity model");
  const confirm = async (m: "gratuity" | "service_fee") => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/admin/price-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, model: m }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error || "Could not save. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl border-2 border-[#B3261E] bg-[#FDECEA] p-4 space-y-3" role="alert" aria-label="Price needs a check">
      <h2 className="font-heading text-base font-bold text-[#8C1D18]">Price needs a check</h2>
      <p className="text-sm text-[#2C2420]">{reason}</p>
      <p className="text-sm text-[#2C2420]">
        Saved on the <span className="font-medium">{label(model)}</span>
        {since ? `, flagged ${since}` : ""}. The price as booked is in Booking summary below. Fix the total with Edit price if it is wrong, then confirm the model.
      </p>
      <p className="text-sm text-[#6B5D52]">Staff pay on this event is not final until this is cleared.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => confirm(model)} disabled={busy} className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium disabled:opacity-50">
          {busy ? "Saving" : `Confirm ${label(model)}`}
        </button>
        <button type="button" onClick={() => confirm(other)} disabled={busy} className="rounded-lg border border-[#2C2420] bg-white text-[#2C2420] px-4 py-2 text-sm font-medium disabled:opacity-50">
          Switch to {label(other)}
        </button>
      </div>
      <p className="text-xs text-[#6B5D52]">
        {other === "service_fee"
          ? "Switching carves the service fee out of the total less add ons (20%, 10% on Premium)."
          : "Switching keeps the total and clears the service fee. Set a gratuity with Edit price if the booking has one."}
      </p>
      {error && <p className="text-sm text-[#8C1D18]">{error}</p>}
    </section>
  );
}
