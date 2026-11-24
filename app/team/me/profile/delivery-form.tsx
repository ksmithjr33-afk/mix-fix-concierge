"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DeliveryView } from "@/lib/team/delivery-availability-db";
import {
  CONFIRM_BUTTON,
  DAY_KEYS,
  DAY_LABEL,
  emptyWeek,
  HANDOFF_PREFS,
  HOME_LABEL,
  HOME_TYPES,
  NOTES_MAX,
  SECTION_LINE,
  SECTION_TITLE,
  timeValue,
  type DayKey,
  type WeekWindows,
} from "@/lib/team/delivery-availability";

const field =
  "rounded-lg border border-[#DDD5CC] bg-white px-2 py-1.5 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A] disabled:opacity-40";
const label = "block text-xs text-[#A39585] uppercase tracking-wide";

type Kind = "receive" | "pickup";
type FormDay = Record<Kind, { on: boolean; from: string; to: string }>;
type FormWeek = Record<DayKey, FormDay>;

function toForm(w: WeekWindows | null): FormWeek {
  const week = w ?? emptyWeek();
  return Object.fromEntries(
    DAY_KEYS.map((d) => [d, { receive: { on: week[d].receive.on, from: timeValue(week[d].receive.from), to: timeValue(week[d].receive.to) }, pickup: { on: week[d].pickup.on, from: timeValue(week[d].pickup.from), to: timeValue(week[d].pickup.to) } }])
  ) as FormWeek;
}

/** Status line and the one tap confirm, for the person themself. */
function ConfirmBar({ view, onConfirmed }: { view: DeliveryView; onConfirmed: (v: DeliveryView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  if (!view.asked) return null;
  if (view.status.confirmed) return <p className="text-sm text-[#55684A]">Confirmed for this week. Thank you.</p>;
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/delivery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm" }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      onConfirmed(d.delivery);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`rounded-xl px-3 py-2 space-y-2 ${view.status.overdue ? "bg-[#F6E3DC] text-[#A0412D]" : "bg-[#FFF8EC] border border-[#E3C9A0] text-[#2C2420]"}`}>
      <p className="text-[15px]">
        {view.status.overdue ? "Past the deadline: " : "Confirm by "}
        <strong>{view.status.deadline}</strong>
        {view.self ? "." : ". Only they can confirm."}
      </p>
      {view.self && view.status.set && (
        <button type="button" onClick={confirm} disabled={busy} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
          {busy ? "Saving..." : CONFIRM_BUTTON}
        </button>
      )}
      {view.self && !view.status.set && <p className="text-sm">Fill in your times below and save. Saving confirms this week.</p>}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </div>
  );
}

/** The "Deliveries and pickups" section: on the person's own profile and on the admin staff page. */
export default function DeliveryForm({ initial, staffId }: { initial: DeliveryView; staffId?: string }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [week, setWeek] = useState<FormWeek>(toForm(initial.windows));
  const [home, setHome] = useState<string>(initial.homeType ?? "");
  const [pref, setPref] = useState<string>(initial.handoffPref ?? "");
  const [notes, setNotes] = useState(initial.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const set = (d: DayKey, k: Kind, patch: Partial<FormDay[Kind]>) => setWeek((w) => ({ ...w, [d]: { ...w[d], [k]: { ...w[d][k], ...patch } } }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const res = await fetch("/api/team/delivery", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(staffId ? { staffId } : {}), delivery_windows: week, home_type: home, handoff_pref: pref, delivery_notes: notes }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setView(d.delivery);
      setSaved(d.delivery?.self && d.delivery?.asked ? "Saved and confirmed for this week." : "Saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3" id="deliveries">
      <div>
        <h2 className="font-heading text-base font-bold text-[#2C2420]">{SECTION_TITLE}</h2>
        <p className="text-[15px] text-[#6B5D52]">{SECTION_LINE}</p>
      </div>
      <ConfirmBar view={view} onConfirmed={setView} />
      {view.oldNote && (
        <p className="text-sm text-[#6B5D52]">
          Your old note: &ldquo;{view.oldNote}&rdquo;. Saving this section replaces it.
        </p>
      )}
      <div className="space-y-2">
        {DAY_KEYS.map((d) => (
          <fieldset key={d} className="rounded-xl border border-[#DDD5CC] bg-white/60 px-3 py-2">
            <legend className="px-1 text-sm font-medium text-[#2C2420]">{DAY_LABEL[d]}</legend>
            {(["receive", "pickup"] as const).map((k) => (
              <div key={k} className="flex flex-wrap items-center gap-2 py-1">
                <label className="flex min-h-[44px] items-center gap-2 text-[15px] text-[#2C2420] w-44">
                  <input type="checkbox" checked={week[d][k].on} onChange={(e) => set(d, k, { on: e.target.checked })} className="h-5 w-5 accent-[#B5845A]" />
                  {k === "receive" ? "Can receive deliveries" : "Can do pickups"}
                </label>
                <span className="flex items-center gap-1 text-sm text-[#6B5D52]">
                  from
                  <input type="time" aria-label={`${DAY_LABEL[d]} ${k} from`} className={field} value={week[d][k].from} disabled={!week[d][k].on} onChange={(e) => set(d, k, { from: e.target.value })} />
                  to
                  <input type="time" aria-label={`${DAY_LABEL[d]} ${k} to`} className={field} value={week[d][k].to} disabled={!week[d][k].on} onChange={(e) => set(d, k, { to: e.target.value })} />
                </span>
              </div>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className={label}>
          Home
          <select className={`${field} mt-1 w-full py-2.5`} value={home} onChange={(e) => setHome(e.target.value)}>
            <option value="">Choose</option>
            {HOME_TYPES.map((h) => (
              <option key={h} value={h}>
                {HOME_LABEL[h]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          I prefer
          <select className={`${field} mt-1 w-full py-2.5`} value={pref} onChange={(e) => setPref(e.target.value)}>
            <option value="">Choose</option>
            {HANDOFF_PREFS.map((h) => (
              <option key={h} value={h}>
                {h === "either" ? "Either" : h === "delivery" ? "Delivery" : "Pickup"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={label}>
        Notes
        <input className={`${field} mt-1 w-full py-2.5`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={NOTES_MAX} placeholder="e.g. Gate code 1234, leave at the side door" />
      </label>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-xl bg-[#B5845A] text-white px-5 py-2.5 font-medium disabled:opacity-40">
          {busy ? "Saving..." : "Save deliveries and pickups"}
        </button>
        {saved && <span className="text-sm text-[#55684A]">{saved}</span>}
      </div>
    </form>
  );
}
