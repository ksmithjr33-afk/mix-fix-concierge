"use client";

import { useRef, useState } from "react";
import type { AgreementView } from "@/lib/team/agreements-db";
import { MB, putToSignedUrl } from "../../../put-upload";

const field = "w-full rounded-lg border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]";
const TYPES = ["application/pdf", "image/png", "image/jpeg"];

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/team/admin/agreements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error ?? "Could not save.");
  return d;
}

const fileError = (f: File) => (!TYPES.includes(f.type) ? "Upload a PDF, PNG or JPG." : f.size > 15 * MB ? "That file is too large. The limit is 15 MB." : "");

/**
 * The Agreement card on the manager view's Agreement tab, admins and managers
 * only (it has pricing). The original agreement and any change orders: PDF,
 * PNG or JPG, each with an optional label, who uploaded it and when, and
 * Replace and Remove.
 */
export default function AgreementCard({ sessionId, initial }: { sessionId: string; initial: AgreementView[] }) {
  const [files, setFiles] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState("");
  const add = useRef<HTMLInputElement>(null);

  const upload = async (f: File, opts: { label?: string; replaces?: string }) => {
    const bad = fileError(f);
    if (bad) return setError(bad);
    setBusy(opts.replaces ?? "add");
    setError("");
    try {
      const start = await post({ action: "start", sessionId, type: f.type, size: f.size, name: f.name, ...(opts.replaces ? { replaces: opts.replaces } : { label: opts.label ?? "" }) });
      await putToSignedUrl(start.uploadUrl, f);
      const done = await post({ action: "finish", fileId: start.fileId });
      setFiles(done.agreements);
      setFile(null);
      setLabel("");
      if (add.current) add.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload.");
    } finally {
      setBusy("");
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    setError("");
    try {
      setFiles((await post({ action: "remove", fileId: id })).agreements);
      setRemoving("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove.");
    } finally {
      setBusy("");
    }
  };

  const rename = async (id: string, next: string) => {
    try {
      setFiles((await post({ action: "label", fileId: id, label: next })).agreements);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  };

  return (
    <section className="rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3 sm:px-5 sm:py-4 space-y-3" aria-label="Agreement">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-lg font-bold text-[#2C2420]">Agreement</h2>
        <span className="text-xs text-[#A39585]">Admins and managers only</span>
      </div>
      {files.length === 0 ? (
        <p className="text-[15px] text-[#6B5D52]">No agreement uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-[#DDD5CC] border-y border-[#DDD5CC]">
          {files.map((f) => (
            <li key={f.id} className="py-2.5 space-y-1.5">
              <input
                defaultValue={f.label}
                placeholder="Label (optional), like Original agreement"
                maxLength={80}
                aria-label="Label"
                onBlur={(e) => e.target.value.trim() !== f.label && rename(f.id, e.target.value)}
                className={field}
              />
              <p className="text-sm text-[#6B5D52] break-words">
                {f.typeLabel}
                {f.fileName ? ` · ${f.fileName}` : ""} · Uploaded by {f.uploadedBy}, {f.uploadedAt}
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <a href={f.viewHref} target="_blank" rel="noreferrer" className="font-medium text-[#B5845A] underline">
                  View
                </a>
                <a href={f.downloadHref} className="text-[#B5845A] underline">
                  Download
                </a>
                <label className="cursor-pointer text-[#B5845A] underline">
                  {busy === f.id ? "Uploading..." : "Replace"}
                  <input type="file" accept={TYPES.join(",")} className="sr-only" disabled={!!busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], { replaces: f.id })} />
                </label>
                {removing === f.id ? (
                  <span className="flex items-center gap-2">
                    <button type="button" onClick={() => remove(f.id)} disabled={!!busy} className="font-medium text-[#A0412D] underline">
                      Yes, remove
                    </button>
                    <button type="button" onClick={() => setRemoving("")} className="text-[#6B5D52] underline">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setRemoving(f.id)} className="text-[#A0412D] underline">
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <p className="text-sm font-medium text-[#2C2420]">{files.length ? "Add another file, like a change order" : "Upload the agreement"}</p>
        <input ref={add} type="file" accept={TYPES.join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-[#6B5D52]" aria-label="Agreement file" />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" maxLength={80} className={field} aria-label="Label for the new file" />
        <button type="button" onClick={() => file && upload(file, { label })} disabled={!file || !!busy} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-[15px] font-medium disabled:opacity-40">
          {busy === "add" ? "Uploading..." : "Upload"}
        </button>
        <p className="text-xs text-[#A39585]">PDF, PNG or JPG, up to 15 MB. Bartenders, bar backs, servers and helpers never see this.</p>
      </div>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}
