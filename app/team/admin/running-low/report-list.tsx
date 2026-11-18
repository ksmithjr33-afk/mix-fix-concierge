"use client";

import Link from "next/link";
import { useState } from "react";
import type { LowStockView } from "@/lib/team/low-stock-db";
import { LEVEL_LABEL } from "@/lib/team/low-stock";
import { timeLabel } from "@/lib/team/clock-label";

// The Running low reports for admins and managers: event, person, item,
// level, note, and time, with On it (one person takes it, and the person who
// reported it gets a text) and Resolved. Used on the Running low page and at
// the top of an event's Day of tab.

export default function LowStockList({ initial, showEvent = true, empty }: { initial: LowStockView[]; showEvent?: boolean; empty?: string }) {
  const [reports, setReports] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const act = async (id: string, action: "on_it" | "resolve") => {
    setBusy(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      const res = await fetch("/api/team/admin/low-stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setReports((rs) => rs.map((r) => (r.id === id ? (d.report as LowStockView) : r)));
    } catch (err) {
      setErrors((e) => ({ ...e, [id]: err instanceof Error ? err.message : "Could not save." }));
    } finally {
      setBusy(null);
    }
  };

  if (reports.length === 0) return empty ? <p className="text-[15px] text-[#6B5D52]">{empty}</p> : null;
  return (
    <ul className="space-y-2">
      {reports.map((r) => (
        <li
          key={r.id}
          id={`r-${r.id}`}
          className={`rounded-2xl border px-4 py-3 target:ring-2 target:ring-[#B5845A] ${r.status === "resolved" ? "border-[#DDD5CC] bg-[#F5F0EB] opacity-70" : r.level === "out" ? "border-[#E8B4A8] bg-[#FBEDE9]" : "border-[#E3C9A0] bg-[#FFF8EC]"}`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-[15px] text-[#2C2420]">
              <span className="font-bold">{r.item}</span>
              <span className={`ml-2 text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${r.level === "out" ? "bg-[#A0412D] text-white" : "bg-[#E3C9A0] text-[#2C2420]"}`}>{LEVEL_LABEL[r.level]}</span>
            </p>
            <span className="text-xs text-[#6B5D52]">{timeLabel(r.createdAt)}</span>
          </div>
          <p className="text-sm text-[#6B5D52]">
            {r.staffName}
            {showEvent && (r.eventHref ? (
              <>
                {" · "}
                <Link href={r.eventHref} className="underline">
                  {r.eventTitle}
                </Link>
              </>
            ) : (
              " · Kit"
            ))}
            {showEvent && r.eventHref && r.kind === "kit" && " (kit)"}
          </p>
          {r.note && <p className="text-[15px] text-[#4A3F38]">Note: {r.note}</p>}
          {r.status === "resolved" ? (
            <p className="text-sm text-[#55684A] mt-1">Resolved by {r.resolvedBy} {timeLabel(r.resolvedAt)}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {r.status === "on_it" ? (
                <span className="text-sm font-medium text-[#55684A]">{r.takenBy} is on it {timeLabel(r.takenAt)}</span>
              ) : (
                <button type="button" disabled={busy === r.id} onClick={() => act(r.id, "on_it")} className="rounded-xl bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
                  On it
                </button>
              )}
              <button type="button" disabled={busy === r.id} onClick={() => act(r.id, "resolve")} className="rounded-xl border border-[#8B9E7E] text-[#55684A] bg-white px-4 py-2 text-sm font-medium disabled:opacity-40">
                Resolved
              </button>
            </div>
          )}
          {errors[r.id] && <p className="text-sm text-[#A0412D] mt-1">{errors[r.id]}</p>}
        </li>
      ))}
    </ul>
  );
}
