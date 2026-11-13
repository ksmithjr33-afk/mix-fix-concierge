"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MB, putToSignedUrl } from "./put-upload";

const TYPES = ["image/gif", "image/png", "image/jpeg", "image/webp"];

export interface PendingAttachment {
  id: string;
  kind: "gif" | "photo";
  preview: string; // a local preview (object URL) or the GIPHY preview
}

/**
 * One picture or GIF for a chat message or an announcement: uploaded straight
 * to private storage as soon as it is picked, then sent with the message.
 */
export function useAttachment(scope: "chat" | "announcement", sessionId?: string) {
  const [pending, setPending] = useState<PendingAttachment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const objectUrl = useRef<string | null>(null);

  const release = () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  };
  useEffect(() => release, []);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/team/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, sessionId, ...body }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error ?? "Could not attach it.");
    return d;
  };

  const pickFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      setError("");
      const type = file.type.toLowerCase();
      if (!TYPES.includes(type)) return setError("Attach a GIF, PNG, JPG or WEBP.");
      if (file.size > 8 * MB) return setError("That picture is too large. The limit is 8 MB.");
      setBusy(true);
      try {
        const d = await post({ action: "start", type, size: file.size });
        await putToSignedUrl(d.uploadUrl, file);
        release();
        objectUrl.current = URL.createObjectURL(file);
        setPending({ id: d.id, kind: d.kind, preview: objectUrl.current });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not attach it.");
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, sessionId]
  );

  const pickGiphy = useCallback(
    async (giphyId: string, preview: string) => {
      setError("");
      setBusy(true);
      try {
        const d = await post({ action: "giphy", giphyId });
        release();
        setPending({ id: d.id, kind: d.kind, preview });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not attach that GIF.");
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, sessionId]
  );

  const clear = useCallback(() => {
    release();
    setPending(null);
    setError("");
  }, []);

  /** For a text box: a picture pasted from the phone keyboard's GIF picker (or copied) is attached. */
  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      pickFile(file);
    },
    [pickFile]
  );

  return { pending, busy, error, pickFile, pickGiphy, clear, onPaste };
}

type Attachment = ReturnType<typeof useAttachment>;

/** Photo library, camera, and (when the GIPHY key is set) GIF search. */
export function AttachControls({ att, gifSearch }: { att: Attachment; gifSearch: boolean }) {
  const library = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [searching, setSearching] = useState(false);
  const btn = "rounded-lg border border-[#DDD5CC] bg-white px-2.5 py-1.5 text-sm text-[#2C2420] disabled:opacity-40";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={btn} disabled={att.busy} onClick={() => library.current?.click()}>
          Photo
        </button>
        <button type="button" className={btn} disabled={att.busy} onClick={() => camera.current?.click()}>
          Camera
        </button>
        {gifSearch && (
          <button type="button" className={btn} disabled={att.busy} onClick={() => setSearching((s) => !s)} aria-expanded={searching}>
            GIF
          </button>
        )}
        {att.busy && <span className="text-sm text-[#6B5D52]">Attaching...</span>}
        <input
          ref={library}
          type="file"
          accept="image/gif,image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            att.pickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={camera}
          type="file"
          accept="image/jpeg,image/png"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            att.pickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {gifSearch && searching && (
        <GifSearch
          onPick={(id, preview) => {
            setSearching(false);
            att.pickGiphy(id, preview);
          }}
        />
      )}
      {att.pending && (
        <div className="flex items-start gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={att.pending.preview} alt={att.pending.kind === "gif" ? "GIF to send" : "Photo to send"} className="max-h-28 w-auto rounded-lg border border-[#DDD5CC] bg-white" />
          <button type="button" onClick={att.clear} className="text-sm text-[#6B5D52] underline">
            Remove
          </button>
        </div>
      )}
      {att.error && <p className="text-sm text-[#A0412D]">{att.error}</p>}
    </div>
  );
}

function GifSearch({ onPick }: { onPick: (id: string, preview: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; preview: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setBusy(true);
      setError("");
      try {
        const res = await fetch(`/api/team/media/giphy?q=${encodeURIComponent(term)}`, { cache: "no-store" });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error ?? "GIF search is not working right now.");
        setResults(d.results ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "GIF search is not working right now.");
      } finally {
        setBusy(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="rounded-xl border border-[#DDD5CC] bg-white p-2 space-y-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search GIFs"
        aria-label="Search GIFs"
        autoFocus
        className="w-full rounded-lg border border-[#DDD5CC] px-3 py-2 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30"
      />
      {busy && <p className="text-xs text-[#6B5D52]">Searching...</p>}
      {error && <p className="text-xs text-[#A0412D]">{error}</p>}
      {results.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 max-h-64 overflow-y-auto">
          {results.map((r) => (
            <button key={r.id} type="button" onClick={() => onPick(r.id, r.preview)} className="rounded-md overflow-hidden bg-[#F5F0EB]" title={r.title}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.preview} alt={r.title || "GIF"} loading="lazy" className="h-24 w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <p className="text-[10px] text-[#A39585]">Powered by GIPHY</p>
    </div>
  );
}
