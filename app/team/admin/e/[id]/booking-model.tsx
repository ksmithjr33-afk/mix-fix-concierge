"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { editInput } from "./edit-price";

type Model = "gratuity" | "service_fee";
const LAST_GRATUITY_DAY = "2026-11-23";
const LABEL: Record<Model, string> = { gratuity: "Gratuity model", service_fee: "Service fee model" };
export const defaultModelFor = (day: string): Model => (day && day <= LAST_GRATUITY_DAY ? "gratuity" : "service_fee");
export const MODEL_CHANGE_WARNING = "Staff pay and the price breakdown will change.";

const label = "block text-xs text-[#A39585] uppercase tracking-wide mb-1";

// Edit everything, admins only: the day the client booked and the pricing
// model. Saved on its own, not as a client update. A new booked on date moves
// the model to its default (on or before November 23, 2026 is the gratuity
// model); the admin can pick the other one. Changing the model asks first.
export default function BookingModel({
  sessionId,
  bookedOn,
  model,
  today,
}: {
  sessionId: string;
  bookedOn: string; // YYYY-MM-DD, or empty when unknown
  model: Model;
  today: string;
}) {
  const router = useRouter();
  const [day, setDay] = useState(bookedOn);
  const [pick, setPick] = useState<Model>(model);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const changed = day !== bookedOn || pick !== model;

  const save = async () => {
    if (pick !== model && !window.confirm(`Change this event from the ${LABEL[model]} to the ${LABEL[pick]}? ${MODEL_CHANGE_WARNING}`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/admin/booking-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, booked_on: day, pricing_model: pick }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; changedModel?: boolean };
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      setSaved(data.changedModel ? `Saved. This event is on the ${LABEL[pick]} now.` : "Saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="rounded-xl border border-[#DDD5CC] bg-white/60 p-3 space-y-2" data-booking-model>
      <legend className="px-1 text-sm font-medium text-[#2C2420]">Booked on and pricing model</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="bm-day">Booked on</label>
          <input
            id="bm-day"
            type="date"
            max={today}
            className={editInput}
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              if (e.target.value) setPick(defaultModelFor(e.target.value));
            }}
          />
        </div>
        <div>
          <label className={label} htmlFor="bm-model">Pricing model</label>
          <select id="bm-model" className={editInput} value={pick} onChange={(e) => setPick(e.target.value as Model)}>
            <option value="gratuity">{LABEL["gratuity"]}</option>
            <option value="service_fee">{LABEL["service_fee"]}</option>
          </select>
        </div>
      </div>
      {pick !== model && <p className="text-sm text-[#A0412D]">Changing the model: {MODEL_CHANGE_WARNING}</p>}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      {saved && <p className="text-sm text-[#55684A]">{saved}</p>}
      <button type="button" onClick={save} disabled={!changed || busy} className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
        {busy ? "Saving..." : "Save booked on and model"}
      </button>
    </fieldset>
  );
}
