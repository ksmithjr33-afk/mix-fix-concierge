"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WeekStatus } from "@/lib/team/delivery-availability";
import { CONFIRM_BUTTON } from "@/lib/team/delivery-availability";

/** Home screen: shown until the person confirms their deliveries and pickups for this week. */
export default function DeliveryReminderCard({ status }: { status: WeekStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  if (done) return null;
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/delivery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm" }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`rounded-2xl px-4 py-3 space-y-2 ${status.overdue ? "bg-[#F6E3DC] text-[#A0412D]" : "bg-[#FFF8EC] border border-[#E3C9A0] text-[#2C2420]"}`}>
      <p className="text-[15px]">
        <strong>Deliveries and pickups:</strong> {status.overdue ? "past the deadline" : "confirm your times"} for this week by {status.deadline}.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {status.set && (
          <button type="button" onClick={confirm} disabled={busy} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
            {busy ? "Saving..." : CONFIRM_BUTTON}
          </button>
        )}
        <Link href="/team/me/profile#deliveries" className="text-sm underline">
          {status.set ? "Edit my times" : "Fill in my times"}
        </Link>
      </div>
      {error && <p className="text-sm">{error}</p>}
    </div>
  );
}
