"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { scorecardSave } from "../save";

const KINDS = [
  { key: "praise", label: "Praise" },
  { key: "coaching", label: "Coaching" },
  { key: "incident", label: "Incident" },
  { key: "general", label: "General" },
];
const label = (k: string) => KINDS.find((x) => x.key === k)?.label ?? k;
const input = "rounded-lg border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420]";

interface Review {
  id: string;
  kind: string;
  date: string;
  dateText: string;
  body: string;
  author: string;
  createdText: string;
  editedBy: string | null;
  editedText: string | null;
  canEdit: boolean;
}

function Editor({ start, onSave, onCancel, busy }: { start: { kind: string; date: string; body: string }; onSave: (v: { kind: string; date: string; body: string }) => void; onCancel?: () => void; busy: boolean }) {
  const [v, setV] = useState(start);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} aria-label="Type" className={input}>
          {KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
        <input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} aria-label="Date" className={input} />
      </div>
      <textarea value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} rows={3} aria-label="Review" placeholder="What happened" className={`${input} w-full`} />
      <div className="flex gap-2">
        <button type="button" onClick={() => onSave(v)} disabled={busy || !v.body.trim()} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
          {busy ? "Saving..." : "Save review"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm text-[#6B5D52] underline">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** Internal reviews, newest first, filterable by type. Editable by the author and by admins (checked on the server). */
export default function Reviews({ staffId, today, reviews, filter: initialFilter }: { staffId: string; today: string; reviews: Review[]; filter: string }) {
  const router = useRouter();
  const [filter, setFilter] = useState(KINDS.some((k) => k.key === initialFilter) ? initialFilter : "");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shown = filter ? reviews.filter((r) => r.kind === filter) : reviews;

  const send = async (body: Record<string, unknown>, done: () => void) => {
    setBusy(true);
    setError("");
    const r = await scorecardSave(body);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    done();
    router.refresh();
  };

  return (
    <section className="space-y-2">
      <div className="px-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-bold text-[#2C2420]">Reviews</h2>
        <div className="flex gap-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by type" className={input}>
            <option value="">All types</option>
            {KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
          {!adding && (
            <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-[#B5845A] text-[#9A7049] px-3 py-2 text-sm">
              Add review
            </button>
          )}
        </div>
      </div>
      {adding && (
        <div className="rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3">
          <Editor start={{ kind: "general", date: today, body: "" }} busy={busy} onCancel={() => setAdding(false)} onSave={(v) => send({ action: "review_add", staffId, ...v }, () => setAdding(false))} />
        </div>
      )}
      {error && <p className="px-1 text-sm text-[#A0412D]">{error}</p>}
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3 text-[15px] text-[#6B5D52]">{filter ? "No reviews of that type." : "No reviews yet."}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li key={r.id} className="rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3">
              {editing === r.id ? (
                <Editor start={{ kind: r.kind, date: r.date, body: r.body }} busy={busy} onCancel={() => setEditing("")} onSave={(v) => send({ action: "review_edit", id: r.id, ...v }, () => setEditing(""))} />
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#EFE8E0] text-[#6B5D52]">{label(r.kind)}</span>
                    {r.canEdit && (
                      <button type="button" onClick={() => setEditing(r.id)} className="text-sm text-[#9A7049] underline">
                        Edit
                      </button>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[15px] text-[#2C2420]">{r.body}</p>
                  <p className="text-xs text-[#A39585]">
                    {r.dateText} · by {r.author || "someone"}, {r.createdText}
                    {r.editedBy && r.editedText ? ` · edited by ${r.editedBy} ${r.editedText}` : ""}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
