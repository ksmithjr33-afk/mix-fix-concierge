"use client";

import { useEffect, useRef, useState } from "react";
import type { BarReadyEntry, BarReadyPhoto } from "@/lib/team/bar-ready-db";
import { timeLabel } from "@/lib/team/clock-label";
import { BAR_PHOTO_BUTTON, BAR_PHOTO_TITLE, MAX_BAR_PHOTOS } from "@/lib/team/bar-photo-labels";

export interface BarReadyProps {
  sessionId: string;
  canSubmit: boolean;
  isAdmin: boolean;
  entries: BarReadyEntry[];
  timeZone?: string;
  opensNote?: string; // "Opens at arrival, 4:00 PM" before the window
  reminder?: string; // no photo yet after service started
}

const MAX_SIDE = 1600; // px on the long side: sharp enough to check the setup, small enough for weak signal
const JPEG_QUALITY = 0.75;

/** Shrink the photo on the phone before upload. Falls back to the original file if the browser cannot decode it. */
export async function resizePhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (blob && blob.size > 0) return blob;
  } catch {
    // fall through to the original file
  }
  return file;
}

async function post(form: FormData): Promise<BarReadyEntry[]> {
  const res = await fetch("/api/team/bar-ready", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? "The photo did not upload. Tap Retry.") as Error & { retry: boolean };
    err.retry = res.status >= 500 || res.status === 0;
    throw err;
  }
  return data.entries as BarReadyEntry[];
}

async function upload(sessionId: string, photo: Blob, note: string, replaces: string | null): Promise<BarReadyEntry[]> {
  const form = new FormData();
  form.set("sessionId", sessionId);
  form.set("note", note);
  if (replaces) {
    form.set("action", "retake");
    form.set("photoId", replaces);
  }
  form.set("photo", photo, photo.type === "image/jpeg" ? "bar.jpg" : "bar");
  return post(form);
}

async function removePhoto(sessionId: string, photoId: string): Promise<BarReadyEntry[]> {
  const form = new FormData();
  form.set("sessionId", sessionId);
  form.set("action", "remove");
  form.set("photoId", photoId);
  return post(form);
}

type Shown = BarReadyPhoto & { who: string };

function Thumbs({ photos, who, onOpen, tz, actions }: { photos: BarReadyPhoto[]; who: string; onOpen: (p: Shown) => void; tz?: string; actions?: (p: BarReadyPhoto) => React.ReactNode }) {
  return (
    <ul className="grid grid-cols-2 gap-2">
      {photos.map((p) => (
        <li key={p.id} className="space-y-1">
          {p.url ? (
            <button type="button" onClick={() => onOpen({ ...p, who })} className="block w-full" aria-label="Open photo full size">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage */}
              <img src={p.url} alt="Bar setup" className="w-full aspect-[4/3] object-cover rounded-xl border border-[#DDD5CC]" />
            </button>
          ) : (
            <div className="w-full aspect-[4/3] rounded-xl bg-[#E8DDD5] flex items-center justify-center text-sm text-[#A39585]">Photo unavailable</div>
          )}
          <p className="text-xs text-[#6B5D52]">
            {who}, {timeLabel(p.createdAt, undefined, tz)}
          </p>
          {p.note && <p className="text-sm text-[#2C2420] break-words">{p.note}</p>}
          {actions?.(p)}
        </li>
      ))}
    </ul>
  );
}

function FullSize({ photo, onClose, tz }: { photo: Shown; onClose: () => void; tz?: string }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 text-white text-sm">
        <span>
          {photo.who}, {timeLabel(photo.createdAt, undefined, tz)}
        </span>
        <div className="flex items-center gap-4">
          {photo.url && (
            <a href={photo.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="underline">
              Open original
            </a>
          )}
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage */}
        {photo.url && <img src={photo.url} alt="Bar setup, full size" className="max-w-full max-h-full object-contain" />}
      </div>
      {photo.note && <p className="px-4 py-3 text-white text-[15px] whitespace-pre-wrap break-words">{photo.note}</p>}
    </div>
  );
}

function SubmitSheet({
  sessionId,
  replacing,
  onDone,
  onClose,
}: {
  sessionId: string;
  replacing: string | null; // the photo being retaken
  onDone: (entries: BarReadyEntry[]) => void;
  onClose: () => void;
}) {
  const pickRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    // Straight to the camera or photo library: the sheet is for the preview and the note.
    pickRef.current?.click();
  }, []);
  const [status, setStatus] = useState<"idle" | "preparing" | "uploading" | "failed">("idle");
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setStatus("preparing");
    setError("");
    const small = await resizePhoto(file);
    setPhoto(small);
    setPreview(URL.createObjectURL(small));
    setStatus("idle");
  };

  // The resized photo stays in memory, so Retry resends it without picking again.
  const send = async () => {
    if (!photo) {
      setError("A photo of the bar setup is required.");
      return;
    }
    setStatus("uploading");
    setError("");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        onDone(await upload(sessionId, photo, note, replacing));
        return;
      } catch (err) {
        const retry = (err as { retry?: boolean }).retry !== false;
        if (attempt === 0 && retry) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        setStatus("failed");
        setError(err instanceof Error && !(err instanceof TypeError) ? err.message : "The photo did not upload. Check your signal and tap Retry.");
        return;
      }
    }
  };

  const busy = status === "preparing" || status === "uploading";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={busy ? undefined : onClose}>
      <div className="w-full sm:max-w-md max-h-[90dvh] overflow-y-auto bg-[#F5F0EB] rounded-t-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-[#DDD5CC] flex items-center justify-between">
          <h3 className="font-heading text-base font-bold text-[#2C2420]">{replacing ? "Retake photo" : BAR_PHOTO_TITLE}</h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-sm text-[#6B5D52] disabled:opacity-40">
            Close
          </button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-sm text-[#6B5D52]">A photo of the full bar setup, so the office can see it.</p>
          {/* No capture attribute: the phone offers the camera or the photo library. */}
          <input ref={pickRef} type="file" accept="image/*" onChange={pick} className="hidden" />
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview
            <img src={preview} alt="Bar setup preview" className="w-full max-h-72 object-cover rounded-xl border border-[#DDD5CC]" />
          ) : (
            <div className="w-full aspect-[4/3] rounded-xl border-2 border-dashed border-[#DDD5CC] flex items-center justify-center text-sm text-[#A39585]">
              {status === "preparing" ? "Preparing photo..." : "No photo yet"}
            </div>
          )}
          <button
            type="button"
            onClick={() => pickRef.current?.click()}
            disabled={busy}
            className="w-full rounded-xl border border-[#B5845A] text-[#9A7049] py-2.5 text-sm font-medium disabled:opacity-40"
          >
            {photo ? "Pick a different photo" : BAR_PHOTO_BUTTON}
          </button>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note (optional)"
            maxLength={500}
            rows={2}
            className="w-full resize-none rounded-xl border border-[#DDD5CC] bg-[#E8DDD5] px-3.5 py-2.5 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30"
          />
          {error && <p className="text-sm text-[#A0412D]">{error}</p>}
          <button
            type="button"
            onClick={send}
            disabled={busy || !photo}
            className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40 hover:bg-[#9A7049] transition-colors"
          >
            {status === "uploading" ? "Uploading..." : status === "failed" ? "Retry" : replacing ? "Save new photo" : "Send photo"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "Bar setup photo": at the top of the bartender's Checklist tab, and on the
 * manager's Day of tab. Up to 4 photos each, retake and remove until the event
 * ends. Never required to clock in or for anything else on the page.
 */
export default function BarReadyCard({ sessionId, canSubmit, isAdmin, entries: initial, timeZone: tz, opensNote, reminder }: BarReadyProps) {
  const [entries, setEntries] = useState(initial);
  const [sheet, setSheet] = useState<null | { replaces: string | null }>(null);
  const [full, setFull] = useState<Shown | null>(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const mine = entries.find((e) => e.mine);
  const others = entries.filter((e) => !e.mine);
  const room = (mine?.photos.length ?? 0) < MAX_BAR_PHOTOS;

  const remove = async (id: string) => {
    setRemoving(id);
    setError("");
    try {
      setEntries(await removePhoto(sessionId, id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove it. Try again.");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section className={`bg-[#F5F0EB] rounded-2xl border-2 ${reminder ? "border-[#E3C9A0]" : "border-[#8B9E7E]"} px-4 py-3 sm:px-5 sm:py-4 space-y-3`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-heading text-base font-bold text-[#2C2420]">{BAR_PHOTO_TITLE}</h3>
        {mine && <span className="text-xs text-[#6B5D52]">{mine.photos.length} of {MAX_BAR_PHOTOS}</span>}
      </div>
      {reminder && <p className="text-[15px] text-[#8A4B12]">{reminder}</p>}
      {canSubmit && room && (
        <button
          type="button"
          onClick={() => setSheet({ replaces: null })}
          className="w-full rounded-xl bg-[#8B9E7E] text-white py-4 text-lg font-medium hover:bg-[#7A8D6E] transition-colors"
        >
          {BAR_PHOTO_BUTTON}
        </button>
      )}
      {!canSubmit && !isAdmin && !mine && opensNote && <p className="text-[15px] text-[#6B5D52]">{opensNote}</p>}
      {mine && (
        <Thumbs
          photos={mine.photos}
          who="You"
          tz={tz}
          onOpen={setFull}
          actions={
            canSubmit
              ? (p) => (
                  <div className="flex gap-4">
                    <button type="button" onClick={() => setSheet({ replaces: p.id })} className="py-1 text-sm text-[#B5845A] underline">
                      Retake
                    </button>
                    <button type="button" onClick={() => remove(p.id)} disabled={removing === p.id} className="py-1 text-sm text-[#6B5D52] underline disabled:opacity-40">
                      {removing === p.id ? "Removing..." : "Remove"}
                    </button>
                  </div>
                )
              : undefined
          }
        />
      )}
      {others.map((e) => (
        <div key={e.staffId} className={mine || canSubmit ? "pt-3 border-t border-[#DDD5CC]" : ""}>
          <Thumbs photos={e.photos} who={e.staffFirstName} tz={tz} onOpen={setFull} />
        </div>
      ))}
      {entries.length === 0 && !reminder && (isAdmin || !canSubmit) && <p className="text-sm text-[#6B5D52]">No bar setup photo yet.</p>}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      {sheet && (
        <SubmitSheet
          sessionId={sessionId}
          replacing={sheet.replaces}
          onDone={(next) => {
            setEntries(next);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {full && <FullSize photo={full} tz={tz} onClose={() => setFull(null)} />}
    </section>
  );
}
