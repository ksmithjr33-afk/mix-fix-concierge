"use client";

import { useState } from "react";

/**
 * A picture or GIF in a chat message or announcement. GIFs play inline at a
 * sensible size; tapping opens it larger. Admins get "Remove picture".
 */
export default function AttachmentView({
  attachment,
  isAdmin = false,
  onRemoved,
}: {
  attachment: { id: string; kind: "gif" | "photo"; url: string; removed: boolean };
  isAdmin?: boolean;
  onRemoved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState(attachment.removed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (removed) return <p className="text-xs italic opacity-80">Picture removed by an admin.</p>;

  const remove = async () => {
    if (!window.confirm("Remove this picture for everyone?")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", id: attachment.id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not remove it.");
      setRemoved(true);
      setOpen(false);
      onRemoved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove it.");
    } finally {
      setBusy(false);
    }
  };

  const alt = attachment.kind === "gif" ? "GIF" : "Photo";
  return (
    <div className="space-y-1">
      <button type="button" onClick={() => setOpen(true)} className="block rounded-lg overflow-hidden" aria-label={`Open the ${alt.toLowerCase()} larger`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={attachment.url} alt={alt} loading="lazy" className="max-h-56 max-w-full w-auto rounded-lg bg-black/5" />
      </button>
      {isAdmin && (
        <button type="button" onClick={remove} disabled={busy} className="text-[11px] underline opacity-80 disabled:opacity-40">
          {busy ? "Removing..." : "Remove picture"}
        </button>
      )}
      {error && <p className="text-xs text-[#A0412D]">{error}</p>}
      {open && (
        <div role="dialog" aria-modal="true" aria-label={alt} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={attachment.url} alt={alt} className="max-h-[90dvh] max-w-full rounded-lg" />
          <button type="button" onClick={() => setOpen(false)} className="absolute top-4 right-4 rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-[#2C2420]">
            Close
          </button>
        </div>
      )}
    </div>
  );
}
