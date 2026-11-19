"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The barback on the Booking card. On a Full Bar wedding the barback is on by
// default; an admin can remove it or add it back. Either way it is a price
// change through the normal flow (the admin edit route): the engine's
// difference is shown first, then applied, as a credit or a charge toward the
// remaining balance. The Big Day Bar and Premium show it as included, with no
// control: their barback cannot be removed.

export interface BarbackControlData {
  applies: boolean;
  removable: boolean;
  on: boolean;
  line: string; // "Barback: included", "Barback: removed by client"
  version: number;
}

export default function BarbackControl({ sessionId, data }: { sessionId: string; data: BarbackControlData }) {
  const router = useRouter();
  const [quote, setQuote] = useState<null | { text: string; next: "Included" | "Removed" }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!data.applies) return null;

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/team/admin/event-edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, ...body }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error ?? "Could not save.");
    return d;
  };
  const ask = async (next: "Included" | "Removed") => {
    setBusy(true);
    setError("");
    try {
      const d = await post({ preview: true, changes: { barback: next } });
      setQuote({ text: d.preview?.engineText || "The price stays the same.", next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not price it.");
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!quote) return;
    setBusy(true);
    setError("");
    try {
      await post({ changes: { barback: quote.next }, price: { mode: "engine" }, version: data.version });
      setQuote(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-[#DDD5CC] pt-3 space-y-1.5" data-barback>
      <p className="text-[15px] text-[#2C2420]">{data.line}</p>
      {!data.removable && <p className="text-sm text-[#6B5D52]">Part of this package. It cannot be removed.</p>}
      {data.removable && !quote && (
        <button type="button" onClick={() => ask(data.on ? "Removed" : "Included")} disabled={busy} className="text-sm font-medium text-[#9A7049] underline disabled:opacity-40">
          {busy ? "Pricing..." : data.on ? "Remove the barback" : "Add the barback back"}
        </button>
      )}
      {quote && (
        <div className="rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 space-y-2">
          <p className="text-sm text-[#2C2420]">{quote.next === "Removed" ? "Remove the barback." : "Add the barback back."} {quote.text}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
              {busy ? "Saving..." : "Apply"}
            </button>
            <button type="button" onClick={() => setQuote(null)} disabled={busy} className="text-sm text-[#6B5D52] underline">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </div>
  );
}
