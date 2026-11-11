"use client";

import { useState } from "react";

/** "Enforce certifications": off shows warnings only; on blocks shift requests and adds an admin confirm step. */
export default function EnforceToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={async (e) => {
            const next = e.target.checked;
            setBusy(true);
            setError("");
            try {
              const res = await fetch("/api/team/admin/certs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "enforce", on: next }) });
              const d = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(d.error ?? "Could not save.");
              setOn(next);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save.");
            } finally {
              setBusy(false);
            }
          }}
          className="mt-1 h-5 w-5 accent-[#B5845A]"
        />
        <span>
          <span className="block font-heading font-bold text-[#2C2420]">Enforce certifications</span>
          <span className="block text-sm text-[#6B5D52]">
            {on
              ? "On: bartenders with a missing, rejected, or expired certification cannot request shifts in that market. Admins confirm before assigning them."
              : "Off: warnings only. Bartenders can still request shifts and admins can assign without a confirm step."}
          </span>
        </span>
      </label>
      {error && <p className="text-sm text-[#A0412D] mt-1">{error}</p>}
    </section>
  );
}
