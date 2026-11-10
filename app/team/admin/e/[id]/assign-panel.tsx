"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AssigneeProgress } from "@/lib/team/assignments-db";
import { timeLabel } from "@/lib/team/clock-label";
import { FLAG_LABELS, formatWorked, type PunchFlag } from "@/lib/team/clock";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";

const STATUS = {
  accepted: { text: "Accepted", cls: "bg-[#E4EBDF] text-[#55684A]" },
  offered: { text: "Waiting for reply", cls: "bg-[#FFF3DF] text-[#9A7049]" },
  declined: { text: "Declined", cls: "bg-[#F6E3DC] text-[#A0412D]" },
};

function Bar({ label, checked, total }: { label: string; checked: number; total: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-[#6B5D52]">
        <span>{label}</span>
        <span className="tabular-nums">
          {checked} of {total} checked
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[#DDD5CC] overflow-hidden mt-0.5">
        <div className="h-full bg-[#8B9E7E]" style={{ width: `${total ? (checked / total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

export default function AssignPanel({
  sessionId,
  summary,
  covered,
  people,
  available,
}: {
  sessionId: string;
  summary: string;
  covered: boolean;
  people: AssigneeProgress[];
  available: { id: string; name: string; role: string; declined: boolean }[];
}) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState("");
  const [removing, setRemoving] = useState("");
  const [error, setError] = useState("");

  const call = async (method: "POST" | "DELETE", staffId: string) => {
    setBusy(staffId);
    setError("");
    try {
      const res = await fetch("/api/team/admin/assign", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, staffId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      setPick("");
      setRemoving("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-3">
      <section className={card}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="font-heading text-base font-bold text-[#2C2420]">Bartenders</h2>
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${covered ? "bg-[#E4EBDF] text-[#55684A]" : "bg-[#F6E3DC] text-[#A0412D]"}`}>{summary}</span>
        </div>
        {people.length === 0 ? (
          <p className="text-[15px] text-[#6B5D52] py-1">Nobody assigned yet.</p>
        ) : (
          <ul className="divide-y divide-[#DDD5CC]">
            {people.map((p) => (
              <li key={p.staffId} className="py-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-[#2C2420]">{p.name}</p>
                    <p className="text-xs text-[#6B5D52]">
                      Assigned {timeLabel(p.assignedAt)}
                      {p.respondedAt ? `, replied ${timeLabel(p.respondedAt)}` : ""}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS[p.status].cls}`}>{STATUS[p.status].text}</span>
                </div>
                {p.status !== "declined" && (
                  <>
                    <Bar label="Checklist" checked={p.checklist.checked} total={p.checklist.total} />
                    <Bar label="Shopping list" checked={p.shopping.checked} total={p.shopping.total} />
                    <p className="text-xs text-[#6B5D52]">
                      {p.confirmedAt ? `Has everything, confirmed ${timeLabel(p.confirmedAt)}` : "Has not confirmed the checklist"}
                      {p.barReadyAt ? ` · Bar ready ${timeLabel(p.barReadyAt)}` : ""}
                    </p>
                    {(p.clockIn || p.clockOut) && (
                      <p className="text-xs text-[#2C2420]">
                        {p.clockIn ? `In ${timeLabel(p.clockIn)}` : "Not clocked in"}
                        {p.clockOut ? ` · Out ${timeLabel(p.clockOut)}` : p.clockIn ? " · Still clocked in" : ""}
                        {p.workedMinutes !== null ? ` · ${formatWorked(p.workedMinutes)}` : ""}
                        {p.punchFlags.length > 0 && (
                          <span className="text-[#9A7049]"> · {p.punchFlags.map((f) => FLAG_LABELS[f as PunchFlag] ?? f).join(", ")}</span>
                        )}
                      </p>
                    )}
                  </>
                )}
                {removing === p.staffId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-[#2C2420]">{p.status === "declined" ? "Clear this row?" : `Remove ${p.name.split(" ")[0]}? They get a text.`}</span>
                    <button type="button" onClick={() => call("DELETE", p.staffId)} disabled={!!busy} className="rounded-lg bg-[#A0412D] text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40">
                      {busy === p.staffId ? "Removing..." : "Yes, remove"}
                    </button>
                    <button type="button" onClick={() => setRemoving("")} className="text-sm text-[#6B5D52] underline">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setRemoving(p.staffId)} className="text-sm text-[#A0412D] underline">
                    {p.status === "declined" ? "Clear" : "Remove"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="font-heading text-base font-bold text-[#2C2420] mb-2">Assign someone</h2>
        {available.length === 0 ? (
          <p className="text-[15px] text-[#6B5D52]">Everyone active is already on this event. Add people on the Staff page.</p>
        ) : (
          <div className="flex gap-2">
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              aria-label="Staff member"
              className="flex-1 min-w-0 rounded-xl border border-[#DDD5CC] bg-white px-3 py-2.5 text-[16px] text-[#2C2420]"
            >
              <option value="">Choose a person</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.role === "admin" ? " (admin)" : ""}
                  {s.declined ? " (declined before)" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => call("POST", pick)}
              disabled={!pick || !!busy}
              className="rounded-xl bg-[#B5845A] text-white px-4 py-2.5 font-medium disabled:opacity-40"
            >
              {busy && busy === pick ? "Assigning..." : "Assign"}
            </button>
          </div>
        )}
        <p className="text-xs text-[#A39585] mt-2">They get a text with a link to accept or decline.</p>
        {error && <p className="text-sm text-[#A0412D] mt-2">{error}</p>}
      </section>
    </div>
  );
}
