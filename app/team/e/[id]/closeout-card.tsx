"use client";

import { useEffect, useRef, useState } from "react";
import type { CloseoutView } from "@/lib/team/closeout-db";
import { timeLabel } from "@/lib/team/clock-label";
import { resizePhoto } from "./bar-ready";
import type { SupplyItem } from "@/lib/team/supplies";
import {
  ALCOHOL_QUESTION,
  ANYTHING_ELSE,
  EQUIPMENT_LABELS,
  EQUIPMENT_STATES,
  SUPPLY_LABELS,
  SUPPLY_STATES,
  WRAP_UP_TAB,
  clampCount,
  markAllUsed,
  type EquipmentState,
  type SupplyStateName,
} from "@/lib/team/wrapup";

export interface CloseoutProps {
  sessionId: string;
  canSubmit: boolean;
  mine: CloseoutView | null;
  gear: string[]; // the "From The Mix Fix" checklist items
  items: SupplyItem[]; // what The Mix Fix provided, in the order of the Supplies tab
  clientAlcohol: boolean;
  timeZone?: string;
  onSent?: () => void;
}

const RATINGS: [string, string][] = [
  ["great", "Great"],
  ["fine", "Fine"],
  ["had_problems", "Had problems"],
];
const ratingLabel = (r: string) => RATINGS.find(([k]) => k === r)?.[1] ?? r;
const field =
  "w-full rounded-xl border border-[#DDD5CC] bg-[#E8DDD5] px-3.5 py-2.5 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30";
const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";

type SupplyAnswer = { state: SupplyStateName | ""; count: number };
type EquipAnswer = { state: EquipmentState | ""; note: string };

interface Values {
  rating: string;
  guests: string;
  issues: string;
  supplies: Record<string, SupplyAnswer>;
  equipment: Record<string, EquipAnswer>;
  alcoholLeft: "" | "yes" | "no";
  alcoholNote: string;
}

function valuesOf(c: CloseoutView | null, items: SupplyItem[], gear: string[]): Values {
  const sup = new Map((c?.inventory.supplies ?? []).map((x) => [x.key, x]));
  const eq = new Map((c?.inventory.equipment ?? []).map((x) => [x.item, x]));
  return {
    rating: c?.rating ?? "",
    guests: c?.guestEstimate === null || c?.guestEstimate === undefined ? "" : String(c.guestEstimate),
    issues: c?.issues ?? "",
    supplies: Object.fromEntries(items.map((i) => [i.key, { state: sup.get(i.key)?.state ?? "", count: sup.get(i.key)?.count || 1 }])),
    equipment: Object.fromEntries(gear.map((g) => [g, { state: eq.get(g)?.state ?? "", note: eq.get(g)?.note ?? "" }])),
    alcoholLeft: c?.inventory.alcoholLeft === true ? "yes" : c?.inventory.alcoholLeft === false ? "no" : "",
    alcoholNote: c?.inventory.alcoholNote ?? "",
  };
}

async function send(sessionId: string, v: Values, photo: Blob | null, equipPhotos: Record<string, Blob>): Promise<CloseoutView> {
  const form = new FormData();
  form.set("sessionId", sessionId);
  form.set("rating", v.rating);
  form.set("guests", v.guests);
  form.set("issues", v.issues);
  form.set("supplies", JSON.stringify(v.supplies));
  form.set("equipment", JSON.stringify(v.equipment));
  form.set("alcoholLeft", v.alcoholLeft);
  form.set("alcoholNote", v.alcoholNote);
  if (photo) form.set("photo", photo, photo.type === "image/jpeg" ? "closeout.jpg" : "closeout");
  for (const [g, b] of Object.entries(equipPhotos)) if (v.equipment[g]?.state && v.equipment[g].state !== "returned") form.set(`equipPhoto:${g}`, b, "equipment.jpg");
  const res = await fetch("/api/team/closeout", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? "Could not save. Tap Retry.") as Error & { retry: boolean };
    err.retry = res.status >= 500 || res.status === 0;
    throw err;
  }
  return data.closeout as CloseoutView;
}

/** Three big choices in a row, one tap each. */
function Choice<T extends string>({ options, value, onPick, danger = [] }: { options: [T, string][]; value: string; onPick: (v: T) => void; danger?: T[] }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onPick(key)}
          aria-pressed={value === key}
          className={`min-h-12 rounded-xl px-1 py-2 text-sm font-medium border leading-tight ${
            value === key ? (danger.includes(key) ? "bg-[#A0412D] border-[#A0412D] text-white" : "bg-[#2C2420] border-[#2C2420] text-white") : "border-[#DDD5CC] bg-white text-[#2C2420]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Counter({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-3 mt-2">
      <span className="text-sm text-[#6B5D52]">How many unopened?</span>
      <button type="button" onClick={() => onChange(clampCount(value - 1, max))} disabled={value <= 1} className="w-12 h-12 rounded-xl border border-[#DDD5CC] bg-white text-xl font-bold disabled:opacity-30" aria-label="One fewer">
        −
      </button>
      <span className="w-8 text-center text-lg font-bold tabular-nums">{value}</span>
      <button type="button" onClick={() => onChange(clampCount(value + 1, max))} disabled={value >= max} className="w-12 h-12 rounded-xl border border-[#DDD5CC] bg-white text-xl font-bold disabled:opacity-30" aria-label="One more">
        +
      </button>
      <span className="text-xs text-[#A39585]">of {max}</span>
    </div>
  );
}

function PhotoPick({ label, onPick, has }: { label: string; onPick: (b: Blob) => void; has: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPick(await resizePhoto(f));
        }}
      />
      <button type="button" onClick={() => ref.current?.click()} className="text-sm text-[#9A7049] underline py-1">
        {has ? "Photo added. Change it" : label}
      </button>
    </>
  );
}

const SUPPLY_OPTIONS = SUPPLY_STATES.map((k) => [k, SUPPLY_LABELS[k]] as [SupplyStateName, string]);
const EQUIP_OPTIONS = EQUIPMENT_STATES.map((k) => [k, EQUIPMENT_LABELS[k]] as [EquipmentState, string]);

function Form({ sessionId, gear, items, clientAlcohol, initial, onDone, onCancel }: { sessionId: string; gear: string[]; items: SupplyItem[]; clientAlcohol: boolean; initial: CloseoutView | null; onDone: (c: CloseoutView) => void; onCancel?: () => void }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const [v, setV] = useState<Values>(valuesOf(initial, items, gear));
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [equipPhotos, setEquipPhotos] = useState<Record<string, Blob>>({});
  const [status, setStatus] = useState<"idle" | "preparing" | "sending" | "failed">("idle");
  const [error, setError] = useState("");
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setStatus("preparing");
    const small = await resizePhoto(file);
    setPhoto(small);
    setPreview(URL.createObjectURL(small));
    setStatus("idle");
  };

  const setSupply = (key: string, a: Partial<SupplyAnswer>) => setV((x) => ({ ...x, supplies: { ...x.supplies, [key]: { ...x.supplies[key], ...a } } }));
  const setEquip = (g: string, a: Partial<EquipAnswer>) => setV((x) => ({ ...x, equipment: { ...x.equipment, [g]: { ...x.equipment[g], ...a } } }));

  const problem = (): string => {
    if (!v.rating) return "Pick how it went.";
    const s = items.find((i) => !v.supplies[i.key]?.state);
    if (s) return `Mark ${s.item}: Used up, Opened, or Unopened.`;
    const g = gear.find((x) => !v.equipment[x]?.state);
    if (g) return `Mark ${g}: Returned, Missing, or Damaged.`;
    const n = gear.find((x) => v.equipment[x].state !== "returned" && !v.equipment[x].note.trim());
    if (n) return `Add a short note on what happened to ${n}.`;
    if (clientAlcohol && !v.alcoholLeft) return "Answer: did you leave the leftover alcohol with the client?";
    if (clientAlcohol && v.alcoholLeft === "no" && !v.alcoholNote.trim()) return "Add a note on where the leftover alcohol went.";
    if (!photo && !initial) return "Add a photo of the bar broken down and the area cleaned.";
    return "";
  };

  const submit = async () => {
    const p = problem();
    if (p) return setError(p);
    setStatus("sending");
    setError("");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        onDone(await send(sessionId, v, photo, equipPhotos));
        return;
      } catch (err) {
        if (attempt === 0 && (err as { retry?: boolean }).retry !== false) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        setStatus("failed");
        setError(err instanceof Error && !(err instanceof TypeError) ? err.message : "Could not save. Check your signal and tap Retry.");
        return;
      }
    }
  };

  const busy = status === "preparing" || status === "sending";
  const shownPhoto = preview ?? initial?.photoUrl ?? null;
  return (
    <div className="space-y-4">
      <section className={`${card} space-y-4`}>
        <fieldset>
          <legend className="text-sm font-medium text-[#2C2420] mb-1.5">How did it go?</legend>
          <Choice options={RATINGS as [string, string][]} value={v.rating} onPick={(rating) => setV({ ...v, rating })} danger={["had_problems"]} />
        </fieldset>
        <label className="block">
          <span className="text-sm font-medium text-[#2C2420]">Guest count, your best estimate</span>
          <input inputMode="numeric" pattern="[0-9]*" value={v.guests} onChange={(e) => setV({ ...v, guests: e.target.value.replace(/\D/g, "").slice(0, 4) })} className={`${field} mt-1`} />
        </label>
      </section>

      <section className={card}>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-heading text-base font-bold text-[#2C2420]">Supplies</h3>
          {items.length > 0 && (
            <button type="button" onClick={() => setV((x) => ({ ...x, supplies: markAllUsed(items) }))} className="rounded-lg border border-[#B5845A] px-3 py-2 text-sm font-medium text-[#9A7049]">
              Mark all used up
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-[#6B5D52] mt-1">The client provided the supplies for this event, so there is nothing to count.</p>
        ) : (
          <>
            <p className="text-sm text-[#6B5D52] mb-2">Everything The Mix Fix provided. Set them all, then fix the exceptions.</p>
            <ul className="divide-y divide-[#DDD5CC]">
              {items.map((i) => {
                const a = v.supplies[i.key] ?? { state: "", count: 1 };
                return (
                  <li key={i.key} className="py-3">
                    <p className="text-[15px] text-[#2C2420]">
                      {i.item} <span className="text-sm text-[#6B5D52]">{i.quantity}</span>
                    </p>
                    <div className="mt-1.5">
                      <Choice options={SUPPLY_OPTIONS} value={a.state} onPick={(state) => setSupply(i.key, { state, count: state === "unopened" ? clampCount(a.count || 1, i.max) : a.count })} />
                    </div>
                    {a.state === "unopened" && <Counter value={clampCount(a.count || 1, i.max)} max={i.max} onChange={(count) => setSupply(i.key, { count })} />}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className={card}>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-heading text-base font-bold text-[#2C2420]">Equipment</h3>
          <button
            type="button"
            onClick={() => setV((x) => ({ ...x, equipment: Object.fromEntries(gear.map((g) => [g, { state: "returned" as const, note: "" }])) }))}
            className="rounded-lg border border-[#B5845A] px-3 py-2 text-sm font-medium text-[#9A7049]"
          >
            Mark all returned
          </button>
        </div>
        <p className="text-sm text-[#6B5D52] mb-2">The From The Mix Fix items on your checklist.</p>
        <ul className="divide-y divide-[#DDD5CC]">
          {gear.map((g) => {
            const a = v.equipment[g] ?? { state: "", note: "" };
            return (
              <li key={g} className="py-3 space-y-1.5">
                <p className="text-[15px] text-[#2C2420]">{g}</p>
                <Choice options={EQUIP_OPTIONS} value={a.state} onPick={(state) => setEquip(g, { state })} danger={["missing", "damaged"]} />
                {a.state && a.state !== "returned" && (
                  <div className="space-y-1">
                    <textarea value={a.note} onChange={(e) => setEquip(g, { note: e.target.value })} maxLength={300} rows={2} placeholder="What happened? (required)" className={`${field} resize-none`} />
                    <PhotoPick label="Add a photo (optional)" has={!!equipPhotos[g] || !!initial?.problemPhotos[g]} onPick={(b) => setEquipPhotos((p) => ({ ...p, [g]: b }))} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {clientAlcohol && (
        <section className={`${card} space-y-2`}>
          <h3 className="font-heading text-base font-bold text-[#2C2420]">Client alcohol</h3>
          <p className="text-[15px] text-[#2C2420]">{ALCOHOL_QUESTION}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {(["yes", "no"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setV({ ...v, alcoholLeft: k })}
                aria-pressed={v.alcoholLeft === k}
                className={`min-h-12 rounded-xl text-sm font-medium border ${v.alcoholLeft === k ? "bg-[#2C2420] border-[#2C2420] text-white" : "border-[#DDD5CC] bg-white text-[#2C2420]"}`}
              >
                {k === "yes" ? "Yes" : "No"}
              </button>
            ))}
          </div>
          {v.alcoholLeft === "no" && (
            <textarea value={v.alcoholNote} onChange={(e) => setV({ ...v, alcoholNote: e.target.value })} maxLength={500} rows={2} placeholder="Where did it go? (required)" className={`${field} resize-none`} />
          )}
        </section>
      )}

      <section className={`${card} space-y-2`}>
        <p className="text-sm font-medium text-[#2C2420]">Photo of the bar broken down and the area cleaned{initial ? "" : " (required)"}</p>
        <input ref={cameraRef} type="file" accept="image/*" onChange={pick} className="hidden" />
        {shownPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element -- local preview or signed URL
          <img src={shownPhoto} alt="Bar broken down" className="w-full max-h-64 object-cover rounded-xl border border-[#DDD5CC]" />
        ) : (
          <div className="w-full aspect-[4/3] rounded-xl border-2 border-dashed border-[#DDD5CC] flex items-center justify-center text-sm text-[#A39585]">
            {status === "preparing" ? "Preparing photo..." : "No photo yet"}
          </div>
        )}
        <button type="button" onClick={() => cameraRef.current?.click()} disabled={busy} className="w-full rounded-xl bg-[#2C2420] text-white py-3 text-sm font-medium disabled:opacity-40">
          {shownPhoto ? "Retake photo" : "Take or upload photo"}
        </button>
      </section>

      <label className="block">
        <span className="text-sm font-medium text-[#2C2420]">{ANYTHING_ELSE} (optional)</span>
        <textarea value={v.issues} onChange={(e) => setV({ ...v, issues: e.target.value })} maxLength={1000} rows={3} className={`${field} mt-1 resize-none`} />
      </label>

      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy} className="flex-1 rounded-xl bg-[#B5845A] text-white py-4 text-lg font-medium disabled:opacity-40 hover:bg-[#9A7049] transition-colors">
          {status === "sending" ? "Sending..." : status === "failed" ? "Retry" : initial ? "Save changes" : "Submit wrap up"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-xl border border-[#DDD5CC] px-4 text-sm text-[#6B5D52]">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** The wrap up in the order a manager reads it: problems in red, reusable stock, opened, used up (collapsed), then the rest. */
export function CloseoutSummary({ c, tz }: { c: CloseoutView; tz?: string }) {
  const s = c.summary;
  return (
    <div className="space-y-2 text-[15px] text-[#2C2420]">
      {s.problems.length > 0 && (
        <div className="rounded-xl border border-[#E8B4A8] bg-[#FBEDE9] px-3 py-2">
          <p className="font-semibold text-[#A0412D]">Missing or damaged</p>
          <ul className="space-y-1.5 mt-1">
            {s.problems.map((p) => (
              <li key={p.item} className="text-[#A0412D]">
                <span className="font-medium">{p.item}</span>: {EQUIPMENT_LABELS[p.state].toLowerCase()}
                {p.note ? `. ${p.note}` : ""}
                {c.problemPhotos[p.item] && (
                  <a href={c.problemPhotos[p.item]} target="_blank" rel="noopener noreferrer" className="block mt-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage */}
                    <img src={c.problemPhotos[p.item]} alt={`${p.item}`} className="w-32 h-24 object-cover rounded-lg border border-[#E8B4A8]" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(c.gearItems.length > 0 || c.gearNote) && s.problems.length === 0 && (
        <p className="whitespace-pre-wrap break-words text-[#A0412D]">Gear broken or missing: {[c.gearItems.join(", "), c.gearNote].filter(Boolean).join(". ")}</p>
      )}
      {s.unopened.length > 0 && (
        <div>
          <p className="font-semibold">Unopened, can be reused</p>
          <ul className="list-disc pl-5">
            {s.unopened.map((u, i) => (
              <li key={i}>
                {u.item}
                {u.size ? `, ${u.size}` : ""}: {u.count}
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.opened.length > 0 && (
        <div>
          <p className="font-semibold">Opened, some left</p>
          <p>{s.opened.join(", ")}</p>
        </div>
      )}
      {s.used.length > 0 && (
        <details>
          <summary className="cursor-pointer font-semibold">Used up ({s.used.length})</summary>
          <p className="mt-1">{s.used.join(", ")}</p>
        </details>
      )}
      {s.alcohol && <p>Client alcohol: {s.alcohol}</p>}
      {!s.alcohol && c.leftoverNote && <p className="whitespace-pre-wrap break-words">Leftover: {c.leftoverNote}</p>}
      <p>
        <span className={c.rating === "had_problems" ? "font-semibold text-[#A0412D]" : "font-semibold"}>{ratingLabel(c.rating)}</span>
        {c.guestEstimate !== null && <span className="text-[#6B5D52]"> · about {c.guestEstimate} guests</span>}
      </p>
      {c.issues && <p className="whitespace-pre-wrap break-words">Note: {c.issues}</p>}
      {c.photoUrl ? (
        <a href={c.photoUrl} target="_blank" rel="noopener noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage */}
          <img src={c.photoUrl} alt="Bar broken down" className="w-full max-h-64 object-cover rounded-xl border border-[#DDD5CC]" />
        </a>
      ) : (
        <p className="text-sm text-[#A39585]">Photo unavailable</p>
      )}
      <p className="text-xs text-[#6B5D52]">
        Sent by {c.staffFirstName} {timeLabel(c.submittedAt, undefined, tz)}
        {c.edits > 0 ? `, edited ${c.edits === 1 ? "once" : `${c.edits} times`}` : ""}
        {c.reviewedAt ? ` · Reviewed by ${c.reviewedBy ?? "an admin"} ${timeLabel(c.reviewedAt, undefined, tz)}` : ""}
      </p>
    </div>
  );
}

/** The Wrap up tab: the closeout and the inventory, one form, one submit. */
export default function CloseoutCard({ sessionId, canSubmit, mine: initial, gear, items, clientAlcohol, timeZone: tz, onSent }: CloseoutProps) {
  const [mine, setMine] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [justSent, setJustSent] = useState(false);
  return (
    <div className="space-y-3">
      <div className="px-1">
        <h2 className="font-heading text-xl font-bold text-[#2C2420]">{WRAP_UP_TAB}</h2>
        {!mine && canSubmit && <p className="text-[15px] text-[#6B5D52]">One wrap up at the end of the night: how it went, what is left, and the equipment.</p>}
      </div>
      {mine && !editing ? (
        <section className="bg-white rounded-2xl border border-[#DDD5CC] p-4 space-y-3">
          {justSent && <p className="rounded-xl bg-[#8B9E7E] text-white px-3 py-2.5 font-medium">Wrap up sent. Thank you!</p>}
          <CloseoutSummary c={mine} tz={tz} />
          {canSubmit ? (
            <button type="button" onClick={() => setEditing(true)} className="text-sm text-[#B5845A] underline">
              Edit (until an admin reviews it)
            </button>
          ) : (
            <p className="text-xs text-[#6B5D52]">{mine.reviewedAt ? "An admin reviewed your wrap up, so it is locked." : "The wrap up is closed."}</p>
          )}
        </section>
      ) : canSubmit ? (
        <Form
          sessionId={sessionId}
          gear={gear}
          items={items}
          clientAlcohol={clientAlcohol}
          initial={mine}
          onDone={(c) => {
            setMine(c);
            setEditing(false);
            setJustSent(true);
            onSent?.();
          }}
          onCancel={mine ? () => setEditing(false) : undefined}
        />
      ) : (
        <p className="text-[15px] text-[#6B5D52] px-1">The wrap up opens once bar service starts.</p>
      )}
    </div>
  );
}
