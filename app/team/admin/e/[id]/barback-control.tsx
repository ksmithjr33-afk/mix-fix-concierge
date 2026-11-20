"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The barback on the Booking card. On a Full Bar wedding the barback is on by
// default. Two ways to turn it off:
// - "Remove the barback and credit the client": a price change through the
//   normal flow (the admin edit route). The engine's credit is shown first.
// - "A barback was not part of this booking": no price change at all, for a
//   booking that was never sold one (the staffing route). One confirm line first.
// Turned off as "not part of this booking", it comes back either at no charge
// or with the priced add back; the admin picks. Removed with a credit, it comes
// back priced. The Big Day Bar and Premium show it as included, with no
// control: their barback cannot be removed.

export interface BarbackControlData {
  applies: boolean;
  removable: boolean;
  on: boolean;
  notBooked?: boolean;
  line: string; // "Barback: included", "Barback: removed by client", "Barback: not part of this booking, set by Kenneth"
  version: number;
}

type Step =
  | null
  | { kind: "priced"; next: "Included" | "Removed"; text: string }
  | { kind: "notBooked" }
  | { kind: "free" };

const NOT_BOOKED_CONFIRM = "This does not change the price. Use it only when the client was never charged for a barback.";

export default function BarbackControl({ sessionId, data }: { sessionId: string; data: BarbackControlData }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!data.applies) return null;

  const post = async (url: string, body: Record<string, unknown>) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, ...body }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error ?? "Could not save.");
    return d;
  };
  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };
  const quote = (next: "Included" | "Removed") =>
    run(async () => {
      const d = await post("/api/team/admin/event-edit", { preview: true, changes: { barback: next } });
      setStep({ kind: "priced", next, text: d.preview?.engineText || "The price stays the same." });
    }, "Could not price it.");
  const apply = () =>
    run(async () => {
      if (!step) return;
      if (step.kind === "priced") await post("/api/team/admin/event-edit", { changes: { barback: step.next }, price: { mode: "engine" }, version: data.version });
      else await post("/api/team/admin/staffing", { action: step.kind === "notBooked" ? "barback_not_booked" : "barback_add_free" });
      setStep(null);
      router.refresh();
    }, "Could not save.");

  const link = "block text-left text-sm font-medium text-[#9A7049] underline disabled:opacity-40";
  const title =
    step?.kind === "priced"
      ? `${step.next === "Removed" ? "Remove the barback and credit the client." : "Add the barback and charge the client."} ${step.text}`
      : step?.kind === "notBooked"
        ? NOT_BOOKED_CONFIRM
        : step?.kind === "free"
          ? "Add the barback at no charge. The price stays the same."
          : "";

  return (
    <div className="border-t border-[#DDD5CC] pt-3 space-y-1.5" data-barback>
      <p className="text-[15px] text-[#2C2420]">{data.line}</p>
      {!data.removable && <p className="text-sm text-[#6B5D52]">Part of this package. It cannot be removed.</p>}
      {data.removable && !step && (
        <div className="space-y-1.5">
          {data.on ? (
            <>
              <button type="button" onClick={() => quote("Removed")} disabled={busy} className={link}>
                {busy ? "Pricing..." : "Remove the barback and credit the client"}
              </button>
              <button type="button" onClick={() => setStep({ kind: "notBooked" })} disabled={busy} className={link}>
                A barback was not part of this booking
              </button>
            </>
          ) : data.notBooked ? (
            <>
              <button type="button" onClick={() => setStep({ kind: "free" })} disabled={busy} className={link}>
                Add the barback at no charge
              </button>
              <button type="button" onClick={() => quote("Included")} disabled={busy} className={link}>
                {busy ? "Pricing..." : "Add the barback and charge the client"}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => quote("Included")} disabled={busy} className={link}>
              {busy ? "Pricing..." : "Add the barback back"}
            </button>
          )}
        </div>
      )}
      {step && (
        <div className="rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 space-y-2">
          <p className="text-sm text-[#2C2420]">{title}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={apply} disabled={busy} className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
              {busy ? "Saving..." : step.kind === "notBooked" ? "Turn the barback off" : "Apply"}
            </button>
            <button type="button" onClick={() => setStep(null)} disabled={busy} className="text-sm text-[#6B5D52] underline">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </div>
  );
}
