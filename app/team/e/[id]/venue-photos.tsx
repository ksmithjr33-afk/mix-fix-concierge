"use client";

// "Bar and venue photos" on the Location card. Admins and managers add (one
// or more at a time, from the camera or the library), caption, reorder,
// delete, hide carried over ones for this event, and keep bar setup photos as
// venue photos. Assigned staff see the same photos read only. Clients never
// get this card: it only renders on /team pages, from server data that
// already passed the access check.

import { useEffect, useRef, useState } from "react";
import type { VenuePhoto, VenuePhotoView } from "@/lib/team/venue-photos-db";
import { addedLabel, MAX_CAPTION_LENGTH, MAX_PICK_AT_ONCE, PAST_TITLE, VENUE_PHOTOS_TITLE } from "@/lib/team/venue-photos";
import { resizePhoto } from "./bar-ready";

export interface BarSetupChoice {
  id: string;
  url: string | null;
  who: string; // first name
  at: string;
}

const linkBtn = "min-h-[44px] px-1 text-sm text-[#B5845A] underline disabled:opacity-40";
const quietBtn = "min-h-[44px] px-1 text-sm text-[#6B5D52] underline disabled:opacity-40";
const input =
  "w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30";

async function send(sessionId: string, fields: Record<string, string | Blob>): Promise<VenuePhotoView> {
  const form = new FormData();
  form.set("sessionId", sessionId);
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Blob) form.set(k, v, v.type === "image/jpeg" ? "venue.jpg" : v instanceof File ? v.name : "venue");
    else form.set(k, v);
  }
  const res = await fetch("/api/team/admin/venue-photos", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "That did not save. Try again.");
  return data.view as VenuePhotoView;
}

function Thumb({ p, onOpen, label }: { p: VenuePhoto; onOpen: () => void; label?: string }) {
  return (
    <div className="w-28 space-y-1">
      {p.url ? (
        <button type="button" onClick={onOpen} className="block w-28" aria-label={p.caption ? `Open photo: ${p.caption}` : "Open photo full size"}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage */}
          <img src={p.url} alt={p.caption || "Venue photo"} className="w-28 h-20 object-cover rounded-lg border border-[#DDD5CC]" />
        </button>
      ) : (
        <div className="w-28 h-20 rounded-lg bg-[#E8DDD5] flex items-center justify-center text-xs text-[#A39585]">Photo unavailable</div>
      )}
      {p.caption && <p className="text-xs text-[#2C2420] break-words line-clamp-2">{p.caption}</p>}
      {label && <p className="text-[11px] text-[#6B5D52]">{label}</p>}
    </div>
  );
}

function Viewer({ photos, start, onClose, tz }: { photos: VenuePhoto[]; start: number; onClose: () => void; tz?: string }) {
  const [i, setI] = useState(start);
  const p = photos[i];
  const prev = () => setI((n) => (n - 1 + photos.length) % photos.length);
  const next = () => setI((n) => (n + 1) % photos.length);
  const touch = useRef<number | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setI((n) => (n - 1 + photos.length) % photos.length);
      else if (e.key === "ArrowRight") setI((n) => (n + 1) % photos.length);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [photos.length, onClose]);
  if (!p) return null;
  const many = photos.length > 1;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex flex-col"
      role="dialog"
      aria-label="Venue photo"
      onTouchStart={(e) => (touch.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const x = e.changedTouches[0]?.clientX;
        if (touch.current !== null && x !== undefined && many && Math.abs(x - touch.current) > 50) (x < touch.current ? next : prev)();
        touch.current = null;
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 text-white text-sm">
        <span>
          {many ? `${i + 1} of ${photos.length}` : ""} {addedLabel(p.addedAt, tz)}
        </span>
        <div className="flex items-center gap-4">
          {p.url && (
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="underline">
              Open original
            </a>
          )}
          <button type="button" onClick={onClose} className="min-h-[44px]">
            Close
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage */}
        {p.url ? <img src={p.url} alt={p.caption || "Venue photo, full size"} className="max-w-full max-h-full object-contain" /> : <p className="text-white">Photo unavailable</p>}
      </div>
      {p.caption && <p className="px-4 pt-2 text-white text-[15px] whitespace-pre-wrap break-words">{p.caption}</p>}
      {many && (
        <div className="flex justify-between px-4 py-3">
          <button type="button" onClick={prev} className="min-h-[44px] rounded-xl border border-white/40 px-5 text-white">
            Previous
          </button>
          <button type="button" onClick={next} className="min-h-[44px] rounded-xl border border-white/40 px-5 text-white">
            Next
          </button>
        </div>
      )}
    </div>
  );
}

type Picked = { key: string; blob: Blob; preview: string; caption: string };

function AddSheet({ sessionId, onDone, onClose }: { sessionId: string; onDone: (v: VenuePhotoView) => void; onClose: () => void }) {
  const pickRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [status, setStatus] = useState<"idle" | "preparing" | "uploading">("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    pickRef.current?.click();
  }, []);
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_PICK_AT_ONCE - picked.length);
    e.target.value = "";
    if (!files.length) return;
    setStatus("preparing");
    setError("");
    const more: Picked[] = [];
    for (const f of files) {
      const blob = await resizePhoto(f);
      const preview = URL.createObjectURL(blob);
      previews.current.push(preview);
      more.push({ key: `${f.name}-${f.size}-${Math.random()}`, blob, preview, caption: "" });
    }
    setPicked((p) => [...p, ...more]);
    setStatus("idle");
  };

  const upload = async () => {
    setStatus("uploading");
    setError("");
    let view: VenuePhotoView | null = null;
    const left = [...picked];
    while (left.length) {
      const p = left[0];
      setProgress(`Uploading ${picked.length - left.length + 1} of ${picked.length}...`);
      try {
        view = await send(sessionId, { action: "add", photo: p.blob, caption: p.caption });
        left.shift();
      } catch (err) {
        // The ones still to go stay in the sheet, so Retry sends only those.
        setPicked(left);
        setStatus("idle");
        setProgress("");
        setError(err instanceof Error && !(err instanceof TypeError) ? err.message : "A photo did not upload. Check your signal and tap Upload again.");
        if (view) onDone(view);
        return;
      }
    }
    if (view) onDone(view);
    onClose();
  };

  const busy = status !== "idle";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={busy ? undefined : onClose}>
      <div className="w-full sm:max-w-md max-h-[90dvh] overflow-y-auto bg-[#F5F0EB] rounded-t-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-[#DDD5CC] flex items-center justify-between">
          <h3 className="font-heading text-base font-bold text-[#2C2420]">Add bar and venue photos</h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-sm text-[#6B5D52] disabled:opacity-40">
            Close
          </button>
        </div>
        <div className="px-4 py-4 space-y-3">
          {/* No capture attribute: the phone offers the camera or the photo library. */}
          <input ref={pickRef} type="file" accept="image/*,.heic,.heif" multiple onChange={pick} className="hidden" />
          {picked.length === 0 && <p className="text-sm text-[#6B5D52]">{status === "preparing" ? "Preparing photos..." : "No photos picked yet."}</p>}
          <ul className="space-y-3">
            {picked.map((p, i) => (
              <li key={p.key} className="flex gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                <img src={p.preview} alt="" className="w-24 h-20 shrink-0 object-cover rounded-lg border border-[#DDD5CC]" />
                <div className="flex-1 min-w-0 space-y-1">
                  <input
                    className={input}
                    value={p.caption}
                    maxLength={MAX_CAPTION_LENGTH}
                    placeholder="Caption (optional)"
                    aria-label={`Caption for photo ${i + 1}`}
                    disabled={busy}
                    onChange={(e) => setPicked((all) => all.map((x) => (x.key === p.key ? { ...x, caption: e.target.value } : x)))}
                  />
                  <button type="button" disabled={busy} className={quietBtn} onClick={() => setPicked((all) => all.filter((x) => x.key !== p.key))}>
                    Leave out
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-[#6B5D52]">For example: Main bar, reception hall. Load in door. Staff see captions, so leave out the client&apos;s name.</p>
          {picked.length < MAX_PICK_AT_ONCE && (
            <button type="button" onClick={() => pickRef.current?.click()} disabled={busy} className="w-full rounded-xl border border-[#B5845A] text-[#9A7049] py-2.5 text-sm font-medium disabled:opacity-40">
              {picked.length ? "Pick more photos" : "Take or choose photos"}
            </button>
          )}
          {error && <p className="text-sm text-[#A0412D]">{error}</p>}
          <button type="button" onClick={upload} disabled={busy || picked.length === 0} className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40">
            {status === "uploading" ? progress : picked.length > 1 ? `Upload ${picked.length} photos` : "Upload photo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CaptionEdit({ photo, busy, onSave }: { photo: VenuePhoto; busy: boolean; onSave: (caption: string) => void }) {
  const [v, setV] = useState(photo.caption);
  const [seen, setSeen] = useState(photo.caption);
  if (photo.caption !== seen) {
    setSeen(photo.caption);
    setV(photo.caption);
  }
  const dirty = v.trim() !== photo.caption;
  return (
    <div className="flex gap-2 items-center">
      <input className={input} value={v} maxLength={MAX_CAPTION_LENGTH} placeholder="Caption (optional)" aria-label="Caption" onChange={(e) => setV(e.target.value)} disabled={busy} />
      <button type="button" disabled={busy || !dirty} onClick={() => onSave(v)} className="shrink-0 min-h-[44px] rounded-xl bg-[#B5845A] px-3 text-sm text-white font-medium disabled:opacity-40">
        Save
      </button>
    </div>
  );
}

/** The Location card row. Renders nothing for staff when there are no photos. */
export default function VenuePhotos({
  sessionId,
  initial,
  timeZone: tz,
  barSetup = [],
}: {
  sessionId: string;
  initial: VenuePhotoView;
  timeZone?: string;
  barSetup?: BarSetupChoice[]; // this event's bar setup photos, admins and managers only
}) {
  const [view, setView] = useState(initial);
  // A fresh page from the server (after an address edit, say) wins.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setView(initial);
  }
  const [open, setOpen] = useState<{ list: VenuePhoto[]; at: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showBar, setShowBar] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const manage = view.canManage;

  const act = async (tag: string, fields: Record<string, string>) => {
    setBusy(tag);
    setError("");
    try {
      setView(await send(sessionId, fields));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not save. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const move = (i: number, by: number) => {
    const ids = view.own.map((p) => p.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setView((v) => ({ ...v, own: ids.map((id) => v.own.find((p) => p.id === id)!) }));
    void act(`move-${ids[j]}`, { action: "reorder", ids: JSON.stringify(ids) });
  };

  if (!manage && view.own.length === 0 && view.past.length === 0) return null;
  const kept = new Set(view.keptBarReports);

  return (
    <div className="py-2.5 border-b border-[#DDD5CC] last:border-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs text-[#A39585] uppercase tracking-wide">{VENUE_PHOTOS_TITLE}</h4>
        {manage && view.own.length > 0 && (
          <button type="button" className={quietBtn} onClick={() => setEditing((e) => !e)}>
            {editing ? "Done" : "Edit photos"}
          </button>
        )}
      </div>
      {manage && !view.ready && <p className="text-sm text-[#6B5D52]">Venue photos turn on once the venue photos migration runs.</p>}

      {view.own.length > 0 && !editing && (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {view.own.map((p, i) => (
            <li key={p.id} className="shrink-0">
              <Thumb p={p} onOpen={() => setOpen({ list: view.own, at: i })} />
            </li>
          ))}
        </ul>
      )}
      {manage && editing && (
        <ul className="space-y-3">
          {view.own.map((p, i) => (
            <li key={p.id} className="flex gap-3">
              {p.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage
                <img src={p.url} alt="" className="w-20 h-16 shrink-0 object-cover rounded-lg border border-[#DDD5CC]" />
              ) : (
                <div className="w-20 h-16 shrink-0 rounded-lg bg-[#E8DDD5]" />
              )}
              <div className="flex-1 min-w-0 space-y-1">
                <CaptionEdit photo={p} busy={!!busy} onSave={(caption) => act(`cap-${p.id}`, { action: "caption", photoId: p.id, caption })} />
                <div className="flex flex-wrap gap-x-3">
                  <button type="button" className={quietBtn} disabled={!!busy || i === 0} onClick={() => move(i, -1)} aria-label="Move earlier">
                    Move left
                  </button>
                  <button type="button" className={quietBtn} disabled={!!busy || i === view.own.length - 1} onClick={() => move(i, 1)} aria-label="Move later">
                    Move right
                  </button>
                  <button
                    type="button"
                    className="min-h-[44px] px-1 text-sm text-[#A0412D] underline disabled:opacity-40"
                    disabled={!!busy}
                    onClick={() => window.confirm("Delete this photo? It also stops showing on later events at this address.") && act(`del-${p.id}`, { action: "delete", photoId: p.id })}
                  >
                    {busy === `del-${p.id}` ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {manage && view.own.length === 0 && view.ready && <p className="text-sm text-[#6B5D52]">No photos for this event yet.</p>}

      {manage && view.ready && (
        <div className="flex flex-wrap gap-x-4">
          <button type="button" className={linkBtn} onClick={() => setAdding(true)}>
            Add photos
          </button>
          {barSetup.length > 0 && (
            <button type="button" className={linkBtn} onClick={() => setShowBar((s) => !s)} aria-expanded={showBar}>
              Add from bar setup photos
            </button>
          )}
        </div>
      )}
      {manage && showBar && (
        <ul className="grid grid-cols-2 gap-2 rounded-xl border border-[#DDD5CC] bg-white/50 p-2">
          {barSetup.map((b) => (
            <li key={b.id} className="space-y-1">
              {b.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage
                <img src={b.url} alt="Bar setup" className="w-full aspect-[4/3] object-cover rounded-lg border border-[#DDD5CC]" />
              ) : (
                <div className="w-full aspect-[4/3] rounded-lg bg-[#E8DDD5] flex items-center justify-center text-xs text-[#A39585]">Photo unavailable</div>
              )}
              <p className="text-xs text-[#6B5D52]">{b.who}</p>
              {kept.has(b.id) ? (
                <p className="text-sm text-[#55684A]">Kept as a venue photo</p>
              ) : (
                <button type="button" className={linkBtn} disabled={!!busy} onClick={() => act(`keep-${b.id}`, { action: "keep", reportId: b.id })}>
                  {busy === `keep-${b.id}` ? "Keeping..." : "Keep as venue photo"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {view.past.length > 0 && (
        <div className="space-y-1 pt-1">
          <h4 className="text-xs text-[#A39585] uppercase tracking-wide">{PAST_TITLE}</h4>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {view.past.map((p, i) => (
              <li key={p.id} className="shrink-0">
                <Thumb p={p} onOpen={() => setOpen({ list: view.past, at: i })} label={addedLabel(p.addedAt, tz)} />
                {manage && (
                  <button type="button" className={quietBtn} disabled={!!busy} onClick={() => act(`hide-${p.id}`, { action: "hide", photoId: p.id })}>
                    {busy === `hide-${p.id}` ? "Hiding..." : "Hide for this event"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {manage && view.hidden.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-[#6B5D52]">Hidden for this event ({view.hidden.length})</summary>
          <ul className="flex gap-2 overflow-x-auto pt-2 pb-1">
            {view.hidden.map((p) => (
              <li key={p.id} className="shrink-0 opacity-70">
                <Thumb p={p} onOpen={() => setOpen({ list: view.hidden, at: view.hidden.indexOf(p) })} label={addedLabel(p.addedAt, tz)} />
                <button type="button" className={linkBtn} disabled={!!busy} onClick={() => act(`show-${p.id}`, { action: "show", photoId: p.id })}>
                  Show again
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      {adding && <AddSheet sessionId={sessionId} onDone={setView} onClose={() => setAdding(false)} />}
      {open && <Viewer photos={open.list} start={open.at} tz={tz} onClose={() => setOpen(null)} />}
    </div>
  );
}
