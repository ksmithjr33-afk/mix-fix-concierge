"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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

interface Preview {
  priced: boolean;
  bookedTotal: number | null;
  engineAmount: number | null;
  engineNewTotal: number | null;
  engineText: string;
}

const input =
  "w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2.5 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30";
const label = "block text-xs text-[#A39585] uppercase tracking-wide mb-1";

const money = (n: number | null) => (n === null ? "unknown" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

export default function EditEvent({
  sessionId,
  version,
  initial,
  packages,
}: {
  sessionId: string;
  version: number;
  initial: EditValues;
  packages: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const [mode, setMode] = useState<"" | "keep" | "engine" | "manual">("");
  const [manual, setManual] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const changes = useMemo(() => {
    const out: Partial<EditValues> = {};
    for (const k of Object.keys(initial) as Field[]) if (v[k].trim() !== initial[k].trim()) out[k] = v[k];
    return out;
  }, [v, initial]);
  const changedFields = Object.keys(changes) as Field[];
  const pricedChange = changedFields.some((f) => PRICED.includes(f));
  const pricedKey = JSON.stringify(PRICED.map((f) => changes[f] ?? null));

  // The engine's price for the edit, refreshed as the priced fields change.
  useEffect(() => {
    if (!pricedChange) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when a priced field changes
  }, [pricedKey, pricedChange, sessionId]);

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
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      setSaved(`Saved as version ${data.version}. The team got the GHL note, and assigned staff were texted if they need to know.`);
      setOpen(false);
      setMode("");
      setManual("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const canSave =
    changedFields.length > 0 && !busy && (!pricedChange || (mode !== "" && (mode !== "manual" || manual.trim() !== "") && (mode !== "engine" || preview?.engineNewTotal !== null)));

  if (!open) {
    return (
      <section className="space-y-2">
        {saved && <p className="rounded-2xl bg-[#E4EBDF] text-[#55684A] px-4 py-3 text-sm">{saved}</p>}
        <button
          type="button"
          onClick={() => {
            setV(initial);
            setSaved("");
            setOpen(true);
          }}
          className="w-full rounded-xl border-2 border-[#B5845A] text-[#9A7049] py-2.5 font-medium hover:bg-[#F5F0EB]"
        >
          Edit event details
        </button>
      </section>
    );
  }

  return (
    <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Edit event details</h2>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="text-sm text-[#6B5D52] underline">
          Cancel
        </button>
      </div>
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

      {pricedChange && (
        <fieldset className="rounded-xl border border-[#E3C9A0] bg-[#FFF8EC] px-3 py-3 space-y-2">
          <legend className="px-1 text-sm font-bold text-[#2C2420]">Price</legend>
          <label className="flex items-start gap-2 text-[15px] text-[#2C2420]">
            <input type="radio" name="price" className="mt-1" checked={mode === "keep"} onChange={() => setMode("keep")} />
            <span>
              Keep the booked total as is
              <span className="block text-sm text-[#6B5D52]">Booked total {money(preview?.bookedTotal ?? null)}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-[15px] text-[#2C2420]">
            <input type="radio" name="price" className="mt-1" checked={mode === "engine"} onChange={() => setMode("engine")} disabled={preview?.engineNewTotal === null} />
            <span>
              Apply the pricing engine&apos;s difference
              <span className="block text-sm text-[#6B5D52]">
                {previewError
                  ? previewError
                  : !preview
                    ? "Pricing..."
                    : preview.engineNewTotal === null
                      ? "The engine cannot price this change. Keep the total or enter one by hand."
                      : `${preview.engineAmount !== null && preview.engineAmount >= 0 ? "+" : "-"}${money(Math.abs(preview.engineAmount ?? 0))}, new total ${money(preview.engineNewTotal)}`}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-[15px] text-[#2C2420]">
            <input type="radio" name="price" className="mt-1" checked={mode === "manual"} onChange={() => setMode("manual")} />
            <span className="flex-1">
              Enter a new total by hand
              {mode === "manual" && (
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="New total, like 1850"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  className={`${input} mt-1`}
                  autoFocus
                />
              )}
            </span>
          </label>
        </fieldset>
      )}

      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <button type="button" onClick={save} disabled={!canSave} className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40 hover:bg-[#9A7049] transition-colors">
        {busy ? "Saving..." : changedFields.length === 0 ? "No changes yet" : `Save ${changedFields.length} ${changedFields.length === 1 ? "change" : "changes"}`}
      </button>
    </section>
  );
}
