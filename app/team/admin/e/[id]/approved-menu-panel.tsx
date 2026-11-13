"use client";

import { useRef, useState } from "react";
import type { AdminMenuView } from "@/lib/team/approved-menu-db";
import { MB, putToSignedUrl } from "../../../put-upload";

const field = "w-full rounded-lg border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]";
const TYPES = ["application/pdf", "image/png", "image/jpeg"];

function longDay(ymd: string): string {
  if (!ymd) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${ymd}T00:00:00Z`));
}

const fileHref = (sessionId: string, o: { download?: boolean; fileId?: string } = {}) =>
  `/api/team/menu-file?sessionId=${encodeURIComponent(sessionId)}${o.download ? "&download=1" : ""}${o.fileId ? `&fileId=${encodeURIComponent(o.fileId)}` : ""}`;

/**
 * "Approved menu" inside the Menu pickup card: upload the final menu graphic
 * after the client approves it (PDF, PNG or JPG, 15 MB), with the date they
 * approved it. A new upload replaces the current one; the old ones stay in a
 * short history.
 */
export default function ApprovedMenuPanel({ initial, today }: { initial: AdminMenuView; today: string }) {
  const [view, setView] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [approvedOn, setApprovedOn] = useState(initial.current?.approvedOn || today);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/team/admin/approved-menu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error ?? "Could not save.");
    return d;
  };

  const choose = (f: File | null) => {
    setError("");
    setSaved("");
    if (!f) return setFile(null);
    if (!TYPES.includes(f.type)) return setError("Upload a PDF, PNG or JPG.");
    if (f.size > 15 * MB) return setError("That file is too large. The limit is 15 MB.");
    setFile(f);
  };

  const upload = async () => {
    if (!file) return;
    setBusy("upload");
    setError("");
    setSaved("");
    try {
      const start = await post({ action: "start", sessionId: view.sessionId, type: file.type, size: file.size, name: file.name });
      await putToSignedUrl(start.uploadUrl, file);
      const done = await post({ action: "finish", fileId: start.fileId, approvedOn });
      setView(done.view);
      setFile(null);
      if (input.current) input.current.value = "";
      setSaved(view.current ? "Uploaded. It replaced the old menu." : "Uploaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload.");
    } finally {
      setBusy("");
    }
  };

  const saveDate = async () => {
    setBusy("date");
    setError("");
    setSaved("");
    try {
      const d = await post({ action: "date", sessionId: view.sessionId, approvedOn });
      setView(d.view);
      setSaved("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy("");
    }
  };

  const cur = view.current;
  return (
    <div className="border-t border-[#DDD5CC] pt-3 space-y-2" aria-label="Approved menu">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h4 className="font-heading text-[15px] font-bold text-[#2C2420]">Approved menu</h4>
        {view.missing && <span className="text-xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F6E3DC] text-[#A0412D]">Not uploaded, event within 72 hours</span>}
      </div>
      {cur ? (
        <div className="space-y-1">
          {cur.type !== "application/pdf" && (
            <a href={fileHref(view.sessionId)} target="_blank" rel="noopener noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileHref(view.sessionId) + `&v=${cur.id}`} alt="The approved menu" className="max-h-64 w-auto rounded-lg border border-[#DDD5CC] bg-white" />
            </a>
          )}
          <p className="text-[15px] text-[#2C2420]">
            {cur.typeLabel}
            {cur.fileName ? `, ${cur.fileName}` : ""}
          </p>
          <p className="text-sm text-[#6B5D52]">
            Uploaded by {cur.uploadedBy}, {cur.uploadedAt}. Client approved on {longDay(cur.approvedOn) || "not set"}.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <a href={fileHref(view.sessionId)} target="_blank" rel="noopener noreferrer" className="text-[#B5845A] underline">
              View
            </a>
            <a href={fileHref(view.sessionId, { download: true })} className="text-[#B5845A] underline">
              Download
            </a>
          </div>
        </div>
      ) : (
        <p className="text-sm text-[#6B5D52]">Upload the final menu graphic once the client approves it. The client, the bartenders on this event, and the person picking it up can see it.</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-[#A39585] uppercase tracking-wide">
          {cur ? "Replace with a new file" : "Menu file (PDF, PNG or JPG, up to 15 MB)"}
          <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => choose(e.target.files?.[0] ?? null)} className={`${field} mt-1 text-sm`} />
        </label>
        <label className="block text-xs text-[#A39585] uppercase tracking-wide">
          Client approved on
          <input type="date" value={approvedOn} max={today} onChange={(e) => setApprovedOn(e.target.value)} className={`${field} mt-1`} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={upload} disabled={!!busy || !file || !approvedOn} className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
          {busy === "upload" ? "Uploading..." : cur ? "Upload and replace" : "Upload approved menu"}
        </button>
        {cur && !file && approvedOn !== cur.approvedOn && (
          <button type="button" onClick={saveDate} disabled={!!busy} className="text-sm text-[#B5845A] underline disabled:opacity-40">
            {busy === "date" ? "Saving..." : "Save the date"}
          </button>
        )}
        {saved && <span className="text-sm text-[#55684A]">{saved}</span>}
      </div>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}

      {view.history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-[#6B5D52] underline">Earlier menus ({view.history.length})</summary>
          <ul className="mt-1 space-y-1">
            {view.history.map((h) => (
              <li key={h.id} className="text-[#6B5D52]">
                <a href={fileHref(view.sessionId, { fileId: h.id })} target="_blank" rel="noopener noreferrer" className="text-[#B5845A] underline">
                  {h.typeLabel}
                  {h.fileName ? `, ${h.fileName}` : ""}
                </a>{" "}
                · {h.uploadedBy}, {h.uploadedAt}
                {h.approvedOn ? ` · approved ${longDay(h.approvedOn)}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
