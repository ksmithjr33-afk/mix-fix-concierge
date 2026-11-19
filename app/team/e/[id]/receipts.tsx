"use client";

// The Receipts tab, on the staff event page and the admin event page.
//
// Staff (mode "staff"): only their own receipts on this event, each with its
// status; add one, and edit or delete it while it is Submitted. No totals.
// Admins and managers (mode "admin"): every receipt on the event, and upload
// one choosing who paid (a staff member or Company). Admins also Approve, Not
// approved (with a reason) and reopen. The server checks every rule again;
// this card only shows what it was sent.

import { useEffect, useRef, useState } from "react";
import type { Receipt } from "@/lib/team/receipts-db";
import {
  COMPANY,
  COMPANY_LABEL,
  MAX_REASON,
  MAX_RECEIPT_NOTE,
  MAX_RECEIPT_PHOTOS,
  RECEIPT_KIND_LABEL,
  RECEIPT_KINDS,
  RECEIPT_STATUS_LABEL,
  RECEIPTS_NOT_READY,
  RECEIPTS_NOT_SET_UP,
  type ReceiptKind,
} from "@/lib/team/receipts";
import { money } from "@/lib/team/pay";
import { timeLabel } from "@/lib/team/clock-label";
import { resizePhoto } from "./bar-ready";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";
const input =
  "w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30";
const linkBtn = "min-h-[44px] px-1 text-sm text-[#B5845A] underline disabled:opacity-40";
const primary = "rounded-xl bg-[#B5845A] text-white px-4 py-2.5 font-medium min-h-[44px] disabled:opacity-40";
const ghost = "rounded-xl border border-[#DDD5CC] px-4 py-2.5 text-[#6B5D52] min-h-[44px] disabled:opacity-40";

const STATUS_STYLE: Record<Receipt["status"], string> = {
  submitted: "bg-[#FFF3DF] text-[#8A4B12]",
  approved: "bg-[#EEF2EA] text-[#55684A]",
  not_approved: "bg-[#FBE9E4] text-[#A0412D]",
};

const dayText = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

class ApiError extends Error {
  duplicate: boolean;
  constructor(message: string, duplicate: boolean) {
    super(message);
    this.duplicate = duplicate;
  }
}

async function postJson(url: string, body: Record<string, unknown>): Promise<{ receipts?: Receipt[] }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? "Could not save. Try again.", !!data.duplicate);
  return data;
}

async function uploadPhoto(sessionId: string, blob: Blob): Promise<string> {
  const form = new FormData();
  form.set("sessionId", sessionId);
  form.set("action", "photo");
  form.set("photo", blob, blob.type === "image/jpeg" ? "receipt.jpg" : blob instanceof File ? blob.name : "receipt");
  const res = await fetch("/api/team/receipts", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? "A photo did not upload. Check your signal and try again.", false);
  return String(data.path);
}

function StatusChip({ r }: { r: Receipt }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLE[r.status]}`}>{RECEIPT_STATUS_LABEL[r.status]}</span>;
}

function PhotoViewer({ r, start, onClose }: { r: Receipt; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const many = r.photos.length > 1;
  const p = r.photos[i];
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setI((n) => (n - 1 + r.photos.length) % r.photos.length);
      else if (e.key === "ArrowRight") setI((n) => (n + 1) % r.photos.length);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [r.photos.length, onClose]);
  if (!p) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" role="dialog" aria-label="Receipt photo">
      <div className="flex items-center justify-between px-4 py-3 text-white text-sm">
        <span>
          {RECEIPT_KIND_LABEL[r.kind]} {money(r.cents)}
          {many ? ` · ${i + 1} of ${r.photos.length}` : ""}
        </span>
        <div className="flex items-center gap-4">
          <a href={p.href} target="_blank" rel="noopener noreferrer" className="underline">
            Open original
          </a>
          <button type="button" onClick={onClose} className="min-h-[44px]">
            Close
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage */}
        {p.url ? <img src={p.url} alt="Receipt, full size" className="max-w-full max-h-full object-contain" /> : <p className="text-white">Photo unavailable</p>}
      </div>
      {many && (
        <div className="flex justify-between px-4 py-3">
          <button type="button" onClick={() => setI((n) => (n - 1 + r.photos.length) % r.photos.length)} className="min-h-[44px] rounded-xl border border-white/40 px-5 text-white">
            Previous
          </button>
          <button type="button" onClick={() => setI((n) => (n + 1) % r.photos.length)} className="min-h-[44px] rounded-xl border border-white/40 px-5 text-white">
            Next
          </button>
        </div>
      )}
    </div>
  );
}

type Photo = { key: string; path?: string; url: string | null; blob?: Blob };

function ReceiptForm({
  sessionId,
  mode,
  people,
  editing,
  onSaved,
  onClose,
}: {
  sessionId: string;
  mode: "staff" | "admin";
  people: { id: string; name: string }[];
  editing: Receipt | null;
  onSaved: (list: Receipt[]) => void;
  onClose: () => void;
}) {
  const pickRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>(() => (editing ? editing.photoPaths.map((path, n) => ({ key: path, path, url: editing.photos[n]?.url ?? null })) : []));
  const [kind, setKind] = useState<ReceiptKind | "">(editing?.kind ?? "");
  const [amount, setAmount] = useState(editing ? (editing.cents / 100).toFixed(2) : "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [payer, setPayer] = useState(editing ? (editing.paidBy === "company" ? COMPANY : (editing.staffId ?? "")) : "");
  const [status, setStatus] = useState<"idle" | "preparing" | "saving">("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_RECEIPT_PHOTOS - photos.length);
    e.target.value = "";
    if (!files.length) return;
    setStatus("preparing");
    setError("");
    const more: Photo[] = [];
    for (const f of files) {
      const blob = await resizePhoto(f);
      const url = URL.createObjectURL(blob);
      previews.current.push(url);
      more.push({ key: `${f.name}-${f.size}-${Math.random()}`, url, blob });
    }
    setPhotos((p) => [...p, ...more]);
    setStatus("idle");
  };

  const save = async () => {
    setError("");
    if (photos.length === 0) return setError("Add a photo of the receipt.");
    if (!kind) return setError("Pick a type.");
    if (!amount.trim()) return setError("Enter the amount.");
    if (mode === "admin" && !payer) return setError("Pick who paid.");
    setStatus("saving");
    try {
      // New photos go up one at a time, so a weak signal only retries the one that failed.
      const ready: Photo[] = [];
      for (const [n, p] of photos.entries()) {
        if (p.path) {
          ready.push(p);
          continue;
        }
        setProgress(`Uploading photo ${n + 1} of ${photos.length}...`);
        const path = await uploadPhoto(sessionId, p.blob!);
        ready.push({ ...p, path, blob: undefined });
      }
      setPhotos(ready);
      setProgress("Saving...");
      const body: Record<string, unknown> = { sessionId, action: "save", id: editing?.id, kind, amount, note, photos: ready.map((p) => p.path), ...(mode === "admin" ? { payer } : {}) };
      let data: { receipts?: Receipt[] };
      try {
        data = await postJson("/api/team/receipts", body);
      } catch (err) {
        if (!(err instanceof ApiError) || !err.duplicate || !window.confirm(err.message)) throw err;
        data = await postJson("/api/team/receipts", { ...body, confirmDuplicate: true });
      }
      onSaved(data.receipts ?? []);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not save. Check your signal and try again.");
    } finally {
      setStatus("idle");
      setProgress("");
    }
  };

  const busy = status !== "idle";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={busy ? undefined : onClose}>
      <div className="w-full sm:max-w-md max-h-[90dvh] overflow-y-auto bg-[#F5F0EB] rounded-t-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={editing ? "Edit receipt" : "Add a receipt"}>
        <div className="px-4 py-3 border-b border-[#DDD5CC] flex items-center justify-between">
          <h3 className="font-heading text-base font-bold text-[#2C2420]">{editing ? "Edit receipt" : "Add a receipt"}</h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-sm text-[#6B5D52] min-h-[44px] disabled:opacity-40">
            Close
          </button>
        </div>
        <div className="px-4 py-4 space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-[#2C2420]">Photo of the receipt</p>
            {/* No capture attribute: the phone offers the camera or the photo library. */}
            <input ref={pickRef} type="file" accept="image/*,.heic,.heif" multiple onChange={pick} className="hidden" />
            {photos.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {photos.map((p) => (
                  <li key={p.key} className="relative">
                    {p.url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local preview or signed URL
                      <img src={p.url} alt="Receipt photo" className="w-24 h-24 object-cover rounded-lg border border-[#DDD5CC]" />
                    ) : (
                      <div className="w-24 h-24 rounded-lg bg-[#E8DDD5] flex items-center justify-center text-xs text-[#A39585]">Photo</div>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setPhotos((list) => list.filter((x) => x.key !== p.key))}
                      className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-[#2C2420] text-white text-sm"
                      aria-label="Remove this photo"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {photos.length < MAX_RECEIPT_PHOTOS && (
              <button type="button" onClick={() => pickRef.current?.click()} disabled={busy} className="w-full rounded-xl border-2 border-dashed border-[#B5845A] text-[#9A7049] py-3 font-medium disabled:opacity-40">
                {status === "preparing" ? "Preparing photos..." : photos.length ? "Add another photo" : "Take or choose a photo"}
              </button>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-[#2C2420]">Type</legend>
            <div className="grid grid-cols-2 gap-2">
              {RECEIPT_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={`rounded-xl border px-3 py-2.5 text-[15px] min-h-[44px] ${kind === k ? "border-[#B5845A] bg-[#FFF8EC] font-medium text-[#2C2420]" : "border-[#DDD5CC] bg-white text-[#6B5D52]"}`}
                >
                  {RECEIPT_KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm font-medium text-[#2C2420]">
            Amount ($)
            <input className={`${input} mt-1`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="24.00" />
          </label>

          {mode === "admin" && (
            <label className="block text-sm font-medium text-[#2C2420]">
              Who paid
              <select className={`${input} mt-1`} value={payer} onChange={(e) => setPayer(e.target.value)}>
                <option value="">Pick one</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value={COMPANY}>{COMPANY_LABEL}</option>
              </select>
            </label>
          )}

          <label className="block text-sm font-medium text-[#2C2420]">
            Note (optional)
            <input className={`${input} mt-1`} maxLength={MAX_RECEIPT_NOTE} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kroger, 10 bags" />
          </label>

          {error && <p className="text-sm text-[#A0412D]">{error}</p>}
          {progress && <p className="text-sm text-[#6B5D52]">{progress}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy} className={`flex-1 ${primary}`}>
              {status === "saving" ? "Saving..." : editing ? "Save changes" : "Save receipt"}
            </button>
            <button type="button" onClick={onClose} disabled={busy} className={ghost}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewButtons({ sessionId, r, onSaved }: { sessionId: string; r: Receipt; onSaved: (list: Receipt[]) => void }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setError("");
    try {
      const data = await postJson("/api/team/admin/receipts", { sessionId, id: r.id, action, ...extra });
      if (data.receipts) onSaved(data.receipts);
      setAsking(false);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  if (r.status !== "submitted") {
    return (
      <div className="space-y-1">
        {r.paidLocked ? (
          <p className="text-xs text-[#6B5D52]">Its reimbursement is marked paid on Payroll, so it cannot be reopened.</p>
        ) : (
          <button type="button" className={linkBtn} disabled={busy} onClick={() => window.confirm(r.status === "approved" && r.paidBy === "staff" ? "Reopen this receipt? Its reimbursement on Payroll is removed." : "Reopen this receipt?") && send("reopen")}>
            {busy ? "Saving..." : "Reopen"}
          </button>
        )}
        {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {asking ? (
        <div className="space-y-2">
          <label className="block text-sm text-[#2C2420]">
            Reason (the staff member sees this)
            <input className={`${input} mt-1`} maxLength={MAX_REASON} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="The total is not readable" autoFocus />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={busy || !reason.trim()} onClick={() => send("not_approve", { reason })}>
              {busy ? "Saving..." : "Not approved"}
            </button>
            <button type="button" className={ghost} disabled={busy} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-xl bg-[#55684A] text-white px-4 py-2 font-medium min-h-[44px] disabled:opacity-40" disabled={busy} onClick={() => send("approve")}>
            {busy ? "Saving..." : "Approve"}
          </button>
          <button type="button" className={ghost} disabled={busy} onClick={() => setAsking(true)}>
            Not approved
          </button>
        </div>
      )}
      {r.paidBy === "staff" && !asking && <p className="text-xs text-[#6B5D52]">Approving adds it to {r.personName}&apos;s reimbursements on Payroll.</p>}
      {r.paidBy === "company" && !asking && <p className="text-xs text-[#6B5D52]">Paid by Company: approving counts it as a cost on this event.</p>}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </div>
  );
}

export default function Receipts({
  sessionId,
  mode,
  initial,
  ready,
  canApprove = false,
  people = [],
  openUntil = null,
  timeZone,
  preview = "",
}: {
  preview?: string; // an admin in Bartender view who is not assigned: uploading is off, with this note
  sessionId: string;
  mode: "staff" | "admin";
  initial: Receipt[];
  ready: boolean;
  canApprove?: boolean; // admins only
  people?: { id: string; name: string }[]; // admin mode: who can be picked as the payer
  openUntil?: string | null; // staff mode: the last day to add one
  timeZone: string;
}) {
  const [list, setList] = useState(initial);
  const [shown, setShown] = useState(initial);
  if (initial !== shown) {
    setShown(initial);
    setList(initial);
  }
  const [form, setForm] = useState<{ editing: Receipt | null } | null>(null);
  const [viewing, setViewing] = useState<{ r: Receipt; n: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const remove = async (r: Receipt) => {
    if (!window.confirm(`Delete this ${RECEIPT_KIND_LABEL[r.kind]} receipt for ${money(r.cents)}?`)) return;
    setBusy(r.id);
    setError("");
    try {
      const data = await postJson("/api/team/receipts", { sessionId, action: "delete", id: r.id });
      setList(data.receipts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete.");
    } finally {
      setBusy("");
    }
  };

  const waiting = list.filter((r) => r.status === "submitted").length;
  return (
    <div className="space-y-3">
      <div className="px-1">
        <h2 className="font-heading text-xl font-bold text-[#2C2420]">Receipts</h2>
        <p className="text-[15px] text-[#6B5D52]">
          {mode === "staff"
            ? `Add a photo of any receipt for something you bought for this event. ${openUntil ? `You can add receipts through ${dayText(openUntil)}.` : ""}`
            : `Every receipt on this event.${waiting ? ` ${waiting} waiting on review.` : ""}${canApprove ? "" : " Managers can view and upload; an admin approves."}`}
        </p>
      </div>
      {!ready ? (
        <p className={`${card} text-[15px] text-[#9A7049]`}>{mode === "staff" ? RECEIPTS_NOT_SET_UP : RECEIPTS_NOT_READY}</p>
      ) : preview ? (
        <p className={`${card} text-[15px] text-[#6B5D52]`} data-receipts-preview>
          {preview}
        </p>
      ) : (
        <button type="button" onClick={() => setForm({ editing: null })} className={`w-full ${primary} py-3`}>
          Add a receipt
        </button>
      )}
      {error && <p className="text-sm text-[#A0412D] px-1">{error}</p>}
      {ready && list.length === 0 && <p className="px-1 text-[15px] text-[#6B5D52]">{mode === "staff" ? "No receipts from you on this event yet." : "No receipts on this event yet."}</p>}
      <ul className="space-y-3">
        {list.map((r) => (
          <li key={r.id} className={card}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] text-[#2C2420]">
                  {mode === "admin" && <span className="font-medium">{r.personName} · </span>}
                  {RECEIPT_KIND_LABEL[r.kind]} <span className="font-semibold tabular-nums">{money(r.cents)}</span>
                </p>
                {r.note && <p className="text-sm text-[#2C2420] break-words">{r.note}</p>}
                <p className="text-xs text-[#6B5D52]">
                  Added {timeLabel(r.createdAt, undefined, timeZone)}
                  {mode === "admin" && r.uploadedByName && ` by ${r.uploadedByName}`}
                  {r.status !== "submitted" && r.reviewedByName && mode === "admin" && ` · ${RECEIPT_STATUS_LABEL[r.status]} by ${r.reviewedByName}`}
                </p>
              </div>
              <StatusChip r={r} />
            </div>
            {r.status === "not_approved" && r.reason && <p className="mt-1 rounded-lg bg-[#FBE9E4] px-2 py-1 text-sm text-[#A0412D]">Not approved: {r.reason}</p>}
            <ul className="mt-2 flex flex-wrap gap-2">
              {r.photos.map((p, n) => (
                <li key={n}>
                  {p.url ? (
                    <button type="button" onClick={() => setViewing({ r, n })} aria-label={`Open receipt photo ${n + 1} full size`}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage */}
                      <img src={p.url} alt="Receipt" className="w-20 h-20 object-cover rounded-lg border border-[#DDD5CC]" />
                    </button>
                  ) : (
                    <div className="w-20 h-20 rounded-lg bg-[#E8DDD5] flex items-center justify-center text-xs text-[#A39585]">Photo unavailable</div>
                  )}
                </li>
              ))}
            </ul>
            {r.canEdit && (
              <div className="mt-1 flex gap-4">
                <button type="button" className={linkBtn} disabled={!!busy} onClick={() => setForm({ editing: r })}>
                  Edit
                </button>
                <button type="button" className={`${linkBtn} text-[#A0412D]`} disabled={!!busy} onClick={() => remove(r)}>
                  {busy === r.id ? "Deleting..." : "Delete"}
                </button>
              </div>
            )}
            {mode === "admin" && canApprove && (
              <div className="mt-2 border-t border-[#DDD5CC] pt-2">
                <ReviewButtons sessionId={sessionId} r={r} onSaved={setList} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {form && <ReceiptForm sessionId={sessionId} mode={mode} people={people} editing={form.editing} onSaved={setList} onClose={() => setForm(null)} />}
      {viewing && <PhotoViewer r={viewing.r} start={viewing.n} onClose={() => setViewing(null)} />}
    </div>
  );
}
