"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Manager view, top of Details, admins only: a saved change the pricing engine
// could not price. Typing the new total and saving clears price pending and
// sends the normal change order update (new total, difference, payment
// preference) to GHL.
export default function PriceNeededCard({ sessionId, summary, blocks }: { sessionId: string; summary: string; blocks: string[] }) {
  const router = useRouter();
  const [total, setTotal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/admin/price-pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, total }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error || "Could not save. Try again.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl border-2 border-[#B3261E] bg-[#FDECEA] p-4 space-y-3" role="alert" aria-label="Price needed">
      <h2 className="font-heading text-base font-bold text-[#8C1D18]">Price needed</h2>
      <p className="text-sm text-[#2C2420]">{summary}</p>
      {blocks.length > 0 && <pre className="whitespace-pre-wrap text-sm text-[#6B5D52] font-sans">{blocks.join("\n\n")}</pre>}
      <p className="text-sm text-[#6B5D52]">
        The change is saved. Until you set the new total, the client sees no total, and no change order, auto charge or balance reminder goes out.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[#6B5D52] uppercase tracking-wide">
          New total
          <input
            inputMode="decimal"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            placeholder="1850"
            className="block w-36 rounded-lg border border-[#DDD5CC] bg-white px-3 py-2 text-[15px] text-[#2C2420]"
          />
        </label>
        <button type="button" onClick={save} disabled={busy || !total.trim()} className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium disabled:opacity-50">
          {busy ? "Saving" : "Save"}
        </button>
      </div>
      {error && <p className="text-sm text-[#8C1D18]">{error}</p>}
    </section>
  );
}
