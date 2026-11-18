"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { scorecardSave } from "../save";

interface Person {
  staffId: string;
  name: string;
  status: string;
  done: boolean;
  outcome: string | null;
  confidence: number | null;
  notes: string;
  by: string | null;
  atText: string | null;
  overdue: boolean;
}

interface CallEvent {
  sessionId: string;
  title: string;
  dayText: string;
  tuesdayText: string;
  lock: { locked: boolean; by: string | null; atText: string | null };
  lockOverdue: boolean;
  people: Person[];
}

const OUTCOMES = [
  { key: "good", label: "Good" },
  { key: "okay", label: "Okay" },
  { key: "bad", label: "Bad" },
];
const input = "rounded-lg border border-[#DDD5CC] bg-white px-2 py-1.5 text-[16px] text-[#2C2420]";

function CallRow({ sessionId, p }: { sessionId: string; p: Person }) {
  const router = useRouter();
  const [v, setV] = useState({ done: p.done, outcome: p.outcome ?? "", confidence: p.confidence ? String(p.confidence) : "", notes: p.notes });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const change = (patch: Partial<typeof v>) => {
    setV((o) => ({ ...o, ...patch }));
    setDirty(true);
  };
  const save = async () => {
    setBusy(true);
    setError("");
    const r = await scorecardSave({ action: "call", sessionId, staffId: p.staffId, done: v.done, outcome: v.outcome || null, confidence: v.confidence ? Number(v.confidence) : null, notes: v.notes });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDirty(false);
    router.refresh();
  };
  return (
    <li className={`py-3 space-y-2 ${p.overdue && !v.done ? "bg-[#FDF3F0] -mx-4 px-4" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/team/admin/scorecard/${p.staffId}`} className="font-medium text-[#2C2420] underline decoration-[#DDD5CC]">
          {p.name}
        </Link>
        {p.status === "offered" && <span className="text-[11px] text-[#6B5D52]">(offered, not accepted yet)</span>}
        {p.overdue && !v.done && <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F6E3DC] text-[#A0412D]">Call not done</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 text-sm text-[#2C2420]">
          <input type="checkbox" checked={v.done} onChange={(e) => change({ done: e.target.checked })} className="h-5 w-5 accent-[#B5845A]" />
          Call done
        </label>
        <select value={v.outcome} onChange={(e) => change({ outcome: e.target.value })} aria-label={`Outcome for ${p.name}`} className={input}>
          <option value="">Outcome</option>
          {OUTCOMES.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={v.confidence} onChange={(e) => change({ confidence: e.target.value })} aria-label={`Confidence for ${p.name}`} className={input}>
          <option value="">Confidence</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <textarea value={v.notes} onChange={(e) => change({ notes: e.target.value })} rows={2} placeholder="Notes" aria-label={`Notes for ${p.name}`} className={`${input} w-full`} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={busy || !dirty} className="rounded-lg bg-[#B5845A] text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40">
          {busy ? "Saving..." : "Save call"}
        </button>
        {p.by && p.atText && <span className="text-xs text-[#6B5D52]">Called by {p.by}, {p.atText}</span>}
        {error && <span className="text-sm text-[#A0412D]">{error}</span>}
      </div>
    </li>
  );
}

function LockCheck({ e }: { e: CallEvent }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = async () => {
    setBusy(true);
    setError("");
    const r = await scorecardSave({ action: "lock", sessionId: e.sessionId, locked: !e.lock.locked });
    setBusy(false);
    if (!r.ok) setError(r.error);
    else router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="inline-flex items-center gap-2 text-[#2C2420]">
        <input type="checkbox" checked={e.lock.locked} onChange={toggle} disabled={busy} className="h-5 w-5 accent-[#B5845A]" />
        Locked by Tuesday ({e.tuesdayText})
      </label>
      {e.lock.by && e.lock.atText && (
        <span className="text-xs text-[#6B5D52]">
          {e.lock.locked ? "Locked" : "Unlocked"} by {e.lock.by}, {e.lock.atText}
        </span>
      )}
      {e.lockOverdue && <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F6E3DC] text-[#A0412D]">Not locked</span>}
      {error && <span className="text-[#A0412D]">{error}</span>}
    </div>
  );
}

export default function CallsBoard({ events }: { events: CallEvent[] }) {
  if (events.length === 0) return <p className="rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3 text-[15px] text-[#6B5D52]">No events in the next 14 days.</p>;
  return (
    <ul className="space-y-3">
      {events.map((e) => (
        <li key={e.sessionId} className={`rounded-2xl border bg-white px-4 py-3 ${e.lockOverdue ? "border-[#A0412D]" : "border-[#DDD5CC]"}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Link href={`/team/admin/e/${e.sessionId}`} className="font-heading font-bold text-[#2C2420] underline decoration-[#DDD5CC]">
              {e.title}
            </Link>
            <span className="text-sm text-[#6B5D52]">{e.dayText}</span>
          </div>
          <LockCheck e={e} />
          {e.people.length === 0 ? (
            <p className="mt-2 text-sm text-[#6B5D52]">Nobody assigned yet.</p>
          ) : (
            <ul className="divide-y divide-[#EFE8E0]">
              {e.people.map((p) => (
                <CallRow key={p.staffId} sessionId={e.sessionId} p={p} />
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
