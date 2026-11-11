"use client";

import { useEffect, useRef, useState } from "react";
import type { CloseoutView } from "@/lib/team/closeout-db";
import { timeLabel } from "@/lib/team/clock-label";
import { resizePhoto } from "./bar-ready";

export interface CloseoutProps {
  sessionId: string;
  canSubmit: boolean;
  mine: CloseoutView | null;
  gear: string[]; // the "From The Mix Fix" checklist items
  timeZone?: string;
}

const RATINGS: [string, string][] = [
  ["great", "Great"],
  ["fine", "Fine"],
  ["had_problems", "Had problems"],
];
const ratingLabel = (r: string) => RATINGS.find(([k]) => k === r)?.[1] ?? r;
const field =
  "w-full rounded-xl border border-[#DDD5CC] bg-[#E8DDD5] px-3.5 py-2.5 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30";

async function send(sessionId: string, v: Values, photo: Blob | null): Promise<CloseoutView> {
  const form = new FormData();
  form.set("sessionId", sessionId);
  form.set("rating", v.rating);
  form.set("guests", v.guests);
  form.set("issues", v.issues);
  for (const g of v.gear) form.append("gear", g);
  form.set("gearNote", v.gearNote);
  form.set("leftover", v.leftover);
  if (photo) form.set("photo", photo, photo.type === "image/jpeg" ? "closeout.jpg" : "closeout");
  const res = await fetch("/api/team/closeout", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? "Could not save. Tap Retry.") as Error & { retry: boolean };
    err.retry = res.status >= 500 || res.status === 0;
    throw err;
  }
  return data.closeout as CloseoutView;
}

interface Values {
  rating: string;
  guests: string;
  issues: string;
  gear: string[];
  gearNote: string;
  leftover: string;
}

function valuesOf(c: CloseoutView | null): Values {
  return {
    rating: c?.rating ?? "",
    guests: c?.guestEstimate === null || c?.guestEstimate === undefined ? "" : String(c.guestEstimate),
    issues: c?.issues ?? "",
    gear: c?.gearItems ?? [],
    gearNote: c?.gearNote ?? "",
    leftover: c?.leftoverNote ?? "",
  };
}

function Form({ sessionId, gear, initial, onDone, onCancel }: { sessionId: string; gear: string[]; initial: CloseoutView | null; onDone: (c: CloseoutView) => void; onCancel?: () => void }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [v, setV] = useState<Values>(valuesOf(initial));
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [showGear, setShowGear] = useState((initial?.gearItems.length ?? 0) > 0 || !!initial?.gearNote);
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

  const submit = async () => {
    if (!v.rating) return setError("Pick how it went.");
    if (!photo && !initial) return setError("Add a photo of the bar broken down and the area cleaned.");
    setStatus("sending");
    setError("");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        onDone(await send(sessionId, v, photo));
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
      <fieldset>
        <legend className="text-sm font-medium text-[#2C2420] mb-1.5">How did it go?</legend>
        <div className="grid grid-cols-3 gap-2">
          {RATINGS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setV({ ...v, rating: key })}
              aria-pressed={v.rating === key}
              className={`rounded-xl py-2.5 text-sm font-medium border ${
                v.rating === key ? (key === "had_problems" ? "bg-[#A0412D] border-[#A0412D] text-white" : "bg-[#2C2420] border-[#2C2420] text-white") : "border-[#DDD5CC] text-[#2C2420]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="text-sm font-medium text-[#2C2420]">Guest count, your best estimate</span>
        <input inputMode="numeric" pattern="[0-9]*" value={v.guests} onChange={(e) => setV({ ...v, guests: e.target.value.replace(/\D/g, "").slice(0, 4) })} className={`${field} mt-1`} />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-[#2C2420]">Issues (optional)</span>
        <textarea value={v.issues} onChange={(e) => setV({ ...v, issues: e.target.value })} maxLength={1000} rows={3} placeholder="Anything the office should know" className={`${field} mt-1 resize-none`} />
      </label>
      <div>
        <button type="button" onClick={() => setShowGear((s) => !s)} className="text-sm text-[#9A7049] underline">
          {showGear ? "Hide company gear" : "Company gear broken or missing?"}
        </button>
        {showGear && (
          <div className="mt-2 space-y-2">
            <ul className="space-y-1">
              {gear.map((g) => (
                <li key={g}>
                  <label className="flex items-start gap-2 text-[15px] text-[#2C2420]">
                    <input
                      type="checkbox"
                      checked={v.gear.includes(g)}
                      onChange={(e) => setV({ ...v, gear: e.target.checked ? [...v.gear, g] : v.gear.filter((x) => x !== g) })}
                      className="mt-1 h-4 w-4 accent-[#B5845A]"
                    />
                    <span>{g}</span>
                  </label>
                </li>
              ))}
            </ul>
            <textarea value={v.gearNote} onChange={(e) => setV({ ...v, gearNote: e.target.value })} maxLength={500} rows={2} placeholder="What happened to it (optional)" className={`${field} resize-none`} />
          </div>
        )}
      </div>
      <label className="block">
        <span className="text-sm font-medium text-[#2C2420]">Leftover product (optional)</span>
        <textarea value={v.leftover} onChange={(e) => setV({ ...v, leftover: e.target.value })} maxLength={500} rows={2} placeholder="Example: 2 bottles of vodka left with the host" className={`${field} mt-1 resize-none`} />
      </label>
      <div className="space-y-2">
        <p className="text-sm font-medium text-[#2C2420]">Photo of the bar broken down and the area cleaned{initial ? "" : " (required)"}</p>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={pick} className="hidden" />
        <input ref={libraryRef} type="file" accept="image/*" onChange={pick} className="hidden" />
        {shownPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element -- local preview or signed URL
          <img src={shownPhoto} alt="Bar broken down" className="w-full max-h-64 object-cover rounded-xl border border-[#DDD5CC]" />
        ) : (
          <div className="w-full aspect-[4/3] rounded-xl border-2 border-dashed border-[#DDD5CC] flex items-center justify-center text-sm text-[#A39585]">
            {status === "preparing" ? "Preparing photo..." : "No photo yet"}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => cameraRef.current?.click()} disabled={busy} className="rounded-xl bg-[#2C2420] text-white py-2.5 text-sm font-medium disabled:opacity-40">
            {shownPhoto ? "Retake photo" : "Take photo"}
          </button>
          <button type="button" onClick={() => libraryRef.current?.click()} disabled={busy} className="rounded-xl border border-[#B5845A] text-[#9A7049] py-2.5 text-sm font-medium disabled:opacity-40">
            Choose photo
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy} className="flex-1 rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40 hover:bg-[#9A7049] transition-colors">
          {status === "sending" ? "Sending..." : status === "failed" ? "Retry" : initial ? "Save changes" : "Send closeout"}
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

export function CloseoutSummary({ c, tz }: { c: CloseoutView; tz?: string }) {
  return (
    <div className="space-y-1.5 text-[15px] text-[#2C2420]">
      <p>
        <span className={c.rating === "had_problems" ? "font-semibold text-[#A0412D]" : "font-semibold"}>{ratingLabel(c.rating)}</span>
        {c.guestEstimate !== null && <span className="text-[#6B5D52]"> · about {c.guestEstimate} guests</span>}
      </p>
      {c.issues && <p className="whitespace-pre-wrap break-words">Issues: {c.issues}</p>}
      {(c.gearItems.length > 0 || c.gearNote) && (
        <p className="whitespace-pre-wrap break-words text-[#A0412D]">
          Gear broken or missing: {[c.gearItems.join(", "), c.gearNote].filter(Boolean).join(". ")}
        </p>
      )}
      {c.leftoverNote && <p className="whitespace-pre-wrap break-words">Leftover: {c.leftoverNote}</p>}
      {c.photoUrl ? (
        <a href={c.photoUrl} target="_blank" rel="noopener noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage */}
          <img src={c.photoUrl} alt="Bar broken down" className="w-full max-h-64 object-cover rounded-xl border border-[#DDD5CC]" />
        </a>
      ) : (
        <p className="text-sm text-[#A39585]">Photo unavailable</p>
      )}
      <p className="text-xs text-[#6B5D52]">
        Sent {timeLabel(c.submittedAt, undefined, tz)}
        {c.edits > 0 ? `, edited ${c.edits === 1 ? "once" : `${c.edits} times`}` : ""}
      </p>
    </div>
  );
}

/** Closeout card on the event page, after clocking out or from 30 minutes before service ends. */
export default function CloseoutCard({ sessionId, canSubmit, mine: initial, gear, timeZone: tz }: CloseoutProps) {
  const [mine, setMine] = useState(initial);
  const [editing, setEditing] = useState(false);
  return (
    <section className="bg-white rounded-2xl border border-[#DDD5CC] p-4 space-y-3">
      <h2 className="font-heading text-lg font-bold text-[#2C2420]">Closeout</h2>
      {mine && !editing ? (
        <>
          <CloseoutSummary c={mine} tz={tz} />
          {canSubmit ? (
            <button type="button" onClick={() => setEditing(true)} className="text-sm text-[#B5845A] underline">
              Edit (until {timeLabel(mine.editUntil, undefined, tz)})
            </button>
          ) : (
            <p className="text-xs text-[#6B5D52]">Closeouts lock 24 hours after they are sent.</p>
          )}
        </>
      ) : canSubmit ? (
        <>
          {!mine && <p className="text-sm text-[#6B5D52]">Tell the office how it went before you leave. A photo of the bar broken down and the area cleaned is required.</p>}
          <Form
            sessionId={sessionId}
            gear={gear}
            initial={mine}
            onDone={(c) => {
              setMine(c);
              setEditing(false);
            }}
            onCancel={mine ? () => setEditing(false) : undefined}
          />
        </>
      ) : null}
    </section>
  );
}
