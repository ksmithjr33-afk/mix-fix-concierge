"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { scorecardSave } from "../save";

/** Payroll setup done: admins tick it (the server checks again); managers see it read only. */
export default function PayrollTick({ staffId, done, by, at, canTick }: { staffId: string; done: boolean; by: string | null; at: string | null; canTick: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = async () => {
    setBusy(true);
    setError("");
    const r = await scorecardSave({ action: "payroll", staffId, done: !done });
    setBusy(false);
    if (!r.ok) setError(r.error);
    else router.refresh();
  };
  return (
    <div className="mt-2 text-sm text-[#2C2420]">
      <label className="inline-flex items-center gap-2">
        <input type="checkbox" checked={done} onChange={toggle} disabled={!canTick || busy} className="h-5 w-5 accent-[#B5845A]" />
        Payroll setup done
      </label>
      {by && at && <span className="ml-2 text-xs text-[#6B5D52]">{done ? "Ticked" : "Unticked"} by {by} {at}</span>}
      {error && <p className="text-[#A0412D]">{error}</p>}
    </div>
  );
}
