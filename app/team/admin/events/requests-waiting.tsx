"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RequestWaiting } from "@/lib/team/offers-db";
import { managerHref } from "@/lib/team/manager-tabs";

const btn = "min-h-[44px] rounded-lg border border-[#DDD5CC] bg-white px-3 text-sm text-[#2C2420] disabled:opacity-40";

/**
 * Shift requests waiting for approval, at the top of the admin events list.
 * One tap to approve or pass. Tier and rank are for admins and managers only;
 * your own request shows without them, for someone else to answer.
 */
export default function RequestsWaiting({ requests }: { requests: RequestWaiting[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (requests.length === 0) return null;

  const act = async (key: string, action: "confirm" | "release", stepId: string) => {
    setBusy(key);
    setError("");
    try {
      const res = await fetch("/api/team/admin/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, stepId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy("");
      router.refresh();
    }
  };

  const red = requests.some((r) => r.red);
  return (
    <section className={`rounded-2xl border-2 px-4 py-3 space-y-2 ${red ? "border-[#A0412D] bg-[#F6E3DC]" : "border-[#E0B04A] bg-[#FFF8EC]"}`} aria-label="Applications waiting" data-requests-waiting>
      <h2 className={`font-heading text-base font-bold ${red ? "text-[#A0412D]" : "text-[#2C2420]"}`}>Applications waiting: {requests.length}</h2>
      {error && <p className="rounded-xl bg-white text-[#A0412D] px-3 py-2 text-sm">{error}</p>}
      <ul className="divide-y divide-[#DDD5CC]">
        {requests.map((r) => (
          <li key={r.stepId} className="py-2 space-y-1">
            <p className="text-[15px] text-[#2C2420]">
              <strong>{r.name}</strong>
              {r.self ? "" : ` (${r.group} ${r.rank})`} requested{" "}
              <Link href={managerHref(r.sessionId, "team")} className="text-[#B5845A] underline">
                {r.event}
              </Link>{" "}
              on {r.date}.
            </p>
            <p className={`text-xs ${r.red ? "font-medium text-[#A0412D]" : "text-[#6B5D52]"}`}>
              {[r.requestedAt && `Requested ${r.requestedAt}`, r.red && "Waiting more than 4 daytime hours", r.notes && `Look closer: ${r.notes}`].filter(Boolean).join(" · ")}
            </p>
            {r.self ? (
              <p className="text-sm text-[#6B5D52]">This is your request. Someone else approves or passes it.</p>
            ) : (
              <div className="flex gap-2">
                <button type="button" disabled={!!busy} onClick={() => act(`c-${r.stepId}`, "confirm", r.stepId)} className={`${btn} !bg-[#55684A] !text-white !border-[#55684A]`}>
                  {busy === `c-${r.stepId}` ? "Approving..." : "Approve"}
                </button>
                <button type="button" disabled={!!busy} onClick={() => act(`r-${r.stepId}`, "release", r.stepId)} className={btn}>
                  {busy === `r-${r.stepId}` ? "Passing..." : "Pass"}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
