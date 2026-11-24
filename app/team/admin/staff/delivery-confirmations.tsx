"use client";

import { useState } from "react";
import Link from "next/link";
import type { ConfirmationList } from "@/lib/team/delivery-availability-db";
import { DAY_KEYS, DAY_LABEL, timeValue } from "@/lib/team/delivery-availability";

/**
 * Admins and managers: who has and has not confirmed their deliveries and
 * pickups this week. Nobody is reassigned automatically. Admins (not
 * managers) can change the weekly deadline here.
 */
export default function DeliveryConfirmations({ initial, canSetDeadline }: { initial: ConfirmationList; canSetDeadline: boolean }) {
  const [rule, setRule] = useState(initial.rule);
  const [day, setDay] = useState<string>(initial.deadlineSetting.day);
  const [time, setTime] = useState(timeValue(initial.deadlineSetting.minutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const { confirmed, notConfirmed } = initial;

  const save = async () => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/team/delivery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "deadline", day, time }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setRule(d.rule);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 space-y-2" aria-label="Deliveries and pickups this week">
      <div>
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Deliveries and pickups this week</h2>
        <p className="text-sm text-[#6B5D52]">
          {confirmed.length} of {confirmed.length + notConfirmed.length} confirmed. Deadline: {initial.deadline}. One reminder text goes Wednesday at 9 AM to anyone not confirmed. Nobody is reassigned automatically.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-[#A0412D]">Not confirmed ({notConfirmed.length})</p>
          {notConfirmed.length === 0 ? (
            <p className="text-sm text-[#6B5D52]">Everyone has confirmed.</p>
          ) : (
            <ul className="text-[15px] text-[#2C2420]">
              {notConfirmed.map((p) => (
                <li key={p.id}>
                  <Link href={`/team/admin/staff/${p.id}`} className="underline decoration-[#DDD5CC]">
                    {p.name || "No name yet"}
                  </Link>
                  {!p.set && <span className="text-sm text-[#6B5D52]"> · times never filled in</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-[#55684A]">Confirmed ({confirmed.length})</p>
          {confirmed.length === 0 ? (
            <p className="text-sm text-[#6B5D52]">Nobody yet.</p>
          ) : (
            <ul className="text-[15px] text-[#2C2420]">
              {confirmed.map((p) => (
                <li key={p.id}>
                  <Link href={`/team/admin/staff/${p.id}`} className="underline decoration-[#DDD5CC]">
                    {p.name || "No name yet"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {canSetDeadline && (
        <div className="border-t border-[#DDD5CC] pt-2 space-y-2">
          <p className="text-sm text-[#6B5D52]">Weekly deadline: {rule}</p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="Deadline day" className="rounded-lg border border-[#DDD5CC] bg-white px-2 py-2 text-[16px] text-[#2C2420]">
              {DAY_KEYS.map((d) => (
                <option key={d} value={d}>
                  {DAY_LABEL[d]}
                </option>
              ))}
            </select>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Deadline time, Central" className="rounded-lg border border-[#DDD5CC] bg-white px-2 py-2 text-[16px] text-[#2C2420]" />
            <span className="text-sm text-[#6B5D52]">Central</span>
            <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
              {busy ? "Saving..." : "Save deadline"}
            </button>
            {saved && <span className="text-sm text-[#55684A]">Saved.</span>}
          </div>
          {error && <p className="text-sm text-[#A0412D]">{error}</p>}
        </div>
      )}
    </section>
  );
}
