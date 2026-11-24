"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import BookingModel from "./booking-model";
import { editInput, ListFieldset, priceChosen, PriceFieldset, type Mode, type Preview } from "./edit-price";

export interface EditValues {
  event_date: string; // YYYY-MM-DD
  bar_service_start: string; // HH:MM
  bar_service_end: string;
  guest_count: string;
  bartenders: string;
  package: string;
  event_address: string;
  parking_info: string;
  day_of_contact_name: string;
  day_of_contact_phone: string;
  special_requests: string;
}

type Field = keyof EditValues;
const PRICED: Field[] = ["bar_service_start", "bar_service_end", "guest_count", "bartenders", "package"];

const input = editInput;
const label = "block text-xs text-[#A39585] uppercase tracking-wide mb-1";

export default function EditEvent({
  sessionId,
  version,
  initial,
  packages,
  booking,
}: {
  sessionId: string;
  version: number;
  initial: EditValues;
  packages: string[];
  booking?: { bookedOn: string; model: "gratuity" | "service_fee"; today: string }; // admins only
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const [mode, setMode] = useState<Mode>("");
  const [manual, setManual] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [sendList, setSendList] = useState(true);

  const changes = useMemo(() => {
    const out: Partial<EditValues> = {};
    for (const k of Object.keys(initial) as Field[]) if (v[k].trim() !== initial[k].trim()) out[k] = v[k];
    return out;
  }, [v, initial]);
  const changedFields = Object.keys(changes) as Field[];
  const pricedChange = changedFields.some((f) => PRICED.includes(f));
  const changesKey = JSON.stringify(changes);

  // The engine's price and the shopping list change for the edit, refreshed as the fields change.
  useEffect(() => {
    if (changedFields.length === 0) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/team/admin/event-edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, changes, preview: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Could not price this change.");
        setPreview(data.preview);
        setPreviewError("");
      } catch (err) {
        setPreview(null);
        setPreviewError(err instanceof Error ? err.message : "Could not price this change.");
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the changes do
  }, [changesKey, sessionId]);

  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/admin/event-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          version,
          changes,
          price: pricedChange ? { mode, total: mode === "manual" ? manual : undefined } : { mode: "keep" },
          sendList,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      setSaved(`Saved as version ${data.version}. The team got the GHL note, and assigned staff were texted if they need to know.${data.pricePending ? " The price is pending." : ""}`);
      setOpen(false);
      setMode("");
      setManual("");
      setSendList(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const canSave = changedFields.length > 0 && !busy && (!pricedChange || priceChosen(mode, manual, preview));

  if (!open) {
    // Bulk changes only: each field has its own Edit on the cards above.
    return (
      <section className="space-y-2">
        {saved && <p className="rounded-2xl bg-[#E4EBDF] text-[#55684A] px-4 py-3 text-sm">{saved}</p>}
        <p className="px-1 text-center">
          <button
            type="button"
            onClick={() => {
              setV(initial);
              setSaved("");
              setOpen(true);
            }}
            className="inline-flex min-h-[44px] items-center px-2 text-sm text-[#9A7049] underline"
          >
            Edit everything
          </button>
        </p>
      </section>
    );
  }

  return (
    <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Edit everything</h2>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="text-sm text-[#6B5D52] underline">
          Cancel
        </button>
      </div>
      {booking && <BookingModel sessionId={sessionId} bookedOn={booking.bookedOn} model={booking.model} today={booking.today} />}

      <p className="text-sm text-[#6B5D52]">Saves like a client update. The client is not messaged. Signature drinks are not changed here.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={label} htmlFor="ed-date">Event date</label>
          <input id="ed-date" type="date" className={input} value={v.event_date} onChange={set("event_date")} />
        </div>
        <div>
          <label className={label} htmlFor="ed-start">Bar service start</label>
          <input id="ed-start" type="time" className={input} value={v.bar_service_start} onChange={set("bar_service_start")} />
        </div>
        <div>
          <label className={label} htmlFor="ed-end">Bar service end</label>
          <input id="ed-end" type="time" className={input} value={v.bar_service_end} onChange={set("bar_service_end")} />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <label className={label} htmlFor="ed-guests">Guest count</label>
          <input id="ed-guests" type="number" inputMode="numeric" min={1} className={input} value={v.guest_count} onChange={set("guest_count")} />
        </div>
        <div>
          <label className={label} htmlFor="ed-bart">Bartenders</label>
          <input id="ed-bart" type="number" inputMode="numeric" min={1} className={input} value={v.bartenders} onChange={set("bartenders")} />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className={label} htmlFor="ed-pkg">Package</label>
          <select id="ed-pkg" className={input} value={v.package} onChange={set("package")}>
            {packages.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className={label} htmlFor="ed-addr">Address</label>
        <input id="ed-addr" className={input} value={v.event_address} onChange={set("event_address")} />
      </div>
      <div>
        <label className={label} htmlFor="ed-park">Parking notes</label>
        <textarea id="ed-park" rows={2} className={`${input} resize-none`} value={v.parking_info} onChange={set("parking_info")} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="ed-cname">Day of contact name</label>
          <input id="ed-cname" className={input} value={v.day_of_contact_name} onChange={set("day_of_contact_name")} />
        </div>
        <div>
          <label className={label} htmlFor="ed-cphone">Day of contact phone</label>
          <input id="ed-cphone" type="tel" inputMode="tel" className={input} value={v.day_of_contact_phone} onChange={set("day_of_contact_phone")} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="ed-req">Special requests</label>
        <textarea id="ed-req" rows={3} className={`${input} resize-none`} value={v.special_requests} onChange={set("special_requests")} />
      </div>

      {pricedChange && <PriceFieldset mode={mode} setMode={setMode} manual={manual} setManual={setManual} preview={preview} previewError={previewError} />}

      {changedFields.length > 0 && preview?.listChanges && <ListFieldset preview={preview} sendList={sendList} setSendList={setSendList} />}

      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <button type="button" onClick={save} disabled={!canSave} className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40 hover:bg-[#9A7049] transition-colors">
        {busy ? "Saving..." : changedFields.length === 0 ? "No changes yet" : `Save ${changedFields.length} ${changedFields.length === 1 ? "change" : "changes"}`}
      </button>
    </section>
  );
}
