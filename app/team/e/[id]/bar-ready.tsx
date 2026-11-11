"use client";

import { useEffect, useRef, useState } from "react";
import type { BarReadyEntry, BarReadyPhoto } from "@/lib/team/bar-ready-db";
import { timeLabel } from "@/lib/team/clock-label";

export interface BarReadyProps {
  sessionId: string;
  canSubmit: boolean;
  isAdmin: boolean;
  entries: BarReadyEntry[];
  timeZone?: string;
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

async function upload(sessionId: string, photo: Blob, note: string): Promise<BarReadyEntry[]> {
  const form = new FormData();
  form.set("sessionId", sessionId);
  form.set("note", note);
  form.set("photo", photo, photo.type === "image/jpeg" ? "bar.jpg" : "bar");
  const res = await fetch("/api/team/bar-ready", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? "The photo did not upload. Tap Retry.") as Error & { retry: boolean };
    err.retry = res.status >= 500 || res.status === 0;
    throw err;
  }
  return data.entries as BarReadyEntry[];
}

function PhotoThumb({ photo, onOpen }: { photo: BarReadyPhoto; onOpen: (p: BarReadyPhoto) => void }) {
  if (!photo.url) return <div className="w-full aspect-[4/3] rounded-xl bg-[#E8DDD5] flex items-center justify-center text-sm text-[#A39585]">Photo unavailable</div>;
  return (
    <button type="button" onClick={() => onOpen(photo)} className="block w-full" aria-label="Open photo full size">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage */}
      <img src={photo.url} alt="Bar setup" className="w-full max-h-72 object-cover rounded-xl border border-[#DDD5CC]" />
    </button>
  );
}

function Entry({ entry, onOpen, onReplace, tz }: { entry: BarReadyEntry; onOpen: (p: BarReadyPhoto) => void; onReplace?: () => void; tz?: string }) {
  const [showEarlier, setShowEarlier] = useState(false);
  const [latest, ...earlier] = entry.photos;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-heading font-bold text-[#2C2420]">
          {entry.mine ? "Bar ready" : `${entry.staffFirstName}'s bar ready`} at {timeLabel(latest.createdAt, undefined, tz)}
        </p>
        <span className="text-xs text-[#6B5D52] shrink-0">
          {latest.checked} of {latest.total} checked
        </span>
      </div>
      <PhotoThumb photo={latest} onOpen={onOpen} />
      {latest.note && <p className="text-[15px] text-[#2C2420] whitespace-pre-wrap break-words">{latest.note}</p>}
      <div className="flex items-center gap-4">
        {onReplace && (
          <button type="button" onClick={onReplace} className="text-sm text-[#B5845A] underline">
            Replace photo
          </button>
        )}
        {earlier.length > 0 && (
          <button type="button" onClick={() => setShowEarlier((v) => !v)} className="text-sm text-[#6B5D52] underline">
            {showEarlier ? "Hide earlier photos" : `Earlier photos (${earlier.length})`}
          </button>
        )}
      </div>
      {showEarlier && (
        <ul className="grid grid-cols-3 gap-2">
          {earlier.map((p) => (
            <li key={p.id}>
              {p.url ? (
                <button type="button" onClick={() => onOpen(p)} className="block w-full" aria-label="Open earlier photo">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage */}
                  <img src={p.url} alt="Earlier bar setup" className="w-full aspect-square object-cover rounded-lg border border-[#DDD5CC]" />
                </button>
              ) : (
                <div className="w-full aspect-square rounded-lg bg-[#E8DDD5]" />
              )}
              <span className="block text-[11px] text-[#6B5D52] mt-0.5">{timeLabel(p.createdAt, undefined, tz)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FullSize({ photo, onClose, tz }: { photo: BarReadyPhoto; onClose: () => void; tz?: string }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 text-white text-sm">
        <span>{timeLabel(photo.createdAt, undefined, tz)}</span>
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
  replacing: boolean;
  onDone: (entries: BarReadyEntry[]) => void;
  onClose: () => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
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
        onDone(await upload(sessionId, photo, note));
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
          <h3 className="font-heading text-base font-bold text-[#2C2420]">{replacing ? "Replace bar photo" : "Bar is ready"}</h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-sm text-[#6B5D52] disabled:opacity-40">
            Close
          </button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-sm text-[#6B5D52]">Take a photo of the full bar setup. A photo is required.</p>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={pick} className="hidden" />
          <input ref={libraryRef} type="file" accept="image/*" onChange={pick} className="hidden" />
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview
            <img src={preview} alt="Bar setup preview" className="w-full max-h-72 object-cover rounded-xl border border-[#DDD5CC]" />
          ) : (
            <div className="w-full aspect-[4/3] rounded-xl border-2 border-dashed border-[#DDD5CC] flex items-center justify-center text-sm text-[#A39585]">
              {status === "preparing" ? "Preparing photo..." : "No photo yet"}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={busy}
              className="rounded-xl bg-[#2C2420] text-white py-2.5 text-sm font-medium disabled:opacity-40"
            >
              {photo ? "Retake photo" : "Take photo"}
            </button>
            <button
              type="button"
              onClick={() => libraryRef.current?.click()}
              disabled={busy}
              className="rounded-xl border border-[#B5845A] text-[#9A7049] py-2.5 text-sm font-medium disabled:opacity-40"
            >
              Choose photo
            </button>
          </div>
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
            {status === "uploading" ? "Uploading..." : status === "failed" ? "Retry" : replacing ? "Save new photo" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Card at the top of the event page, from arrival time on the event day. Never blocks anything else on the page. */
export default function BarReadyCard({ sessionId, canSubmit, isAdmin, entries: initial, timeZone: tz }: BarReadyProps) {
  const [entries, setEntries] = useState(initial);
  const [sheet, setSheet] = useState<null | "new" | "replace">(null);
  const [full, setFull] = useState<BarReadyPhoto | null>(null);
  const mine = entries.find((e) => e.mine);
  const others = entries.filter((e) => !e.mine);

  return (
    <section className="bg-[#F5F0EB] rounded-2xl border-2 border-[#8B9E7E] px-4 py-3 sm:px-5 sm:py-4 space-y-4">
      {mine ? (
        <Entry entry={mine} tz={tz} onOpen={setFull} onReplace={canSubmit ? () => setSheet("replace") : undefined} />
      ) : (
        canSubmit && (
          <div className="space-y-2">
            <p className="text-[15px] text-[#2C2420]">When the bar is set up, send a photo to the team.</p>
            <button
              type="button"
              onClick={() => setSheet("new")}
              className="w-full rounded-xl bg-[#8B9E7E] text-white py-3 font-medium hover:bg-[#7A8D6E] transition-colors"
            >
              Bar is ready
            </button>
          </div>
        )
      )}
      {others.length > 0 && (
        <div className={`space-y-4 ${mine || canSubmit ? "pt-3 border-t border-[#DDD5CC]" : ""}`}>
          {others.map((e) => (
            <Entry key={e.staffId} entry={e} tz={tz} onOpen={setFull} />
          ))}
        </div>
      )}
      {isAdmin && entries.length === 0 && !canSubmit && <p className="text-sm text-[#6B5D52]">No bar photo yet.</p>}
      {sheet && (
        <SubmitSheet
          sessionId={sessionId}
          replacing={sheet === "replace"}
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
