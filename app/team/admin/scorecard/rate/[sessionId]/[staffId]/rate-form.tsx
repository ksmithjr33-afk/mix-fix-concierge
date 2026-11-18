"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { scorecardSave } from "../../../save";

type Marks = Record<string, number | null>;

const NOTE_AT = 3;

/**
 * The seven marks. Suggestions from the facts fill a mark but stay marked
 * Suggested until the reviewer confirms or changes it; Save waits for that.
 * Blank means unknown and is left out of the average.
 */
export default function RateForm({
  sessionId,
  staffId,
  marks: defs,
  initial,
  suggested,
}: {
  sessionId: string;
  staffId: string;
  marks: { key: string; label: string; help: string }[];
  initial: { marks: Marks; markNotes: Record<string, string>; clientFeedback: string; adminNotes: string } | null;
  suggested: Record<string, { value: number; why: string } | undefined>;
}) {
  const router = useRouter();
  const start: Marks = initial ? initial.marks : Object.fromEntries(defs.map((d) => [d.key, suggested[d.key]?.value ?? null]));
  const [marks, setMarks] = useState<Marks>(start);
  // Suggested and not yet confirmed: only on a new rating.
  const [pending, setPending] = useState<Set<string>>(new Set(initial ? [] : defs.filter((d) => suggested[d.key]).map((d) => d.key)));
  const [notes, setNotes] = useState<Record<string, string>>(initial?.markNotes ?? {});
  const [clientFeedback, setClientFeedback] = useState(initial?.clientFeedback ?? "");
  const [adminNotes, setAdminNotes] = useState(initial?.adminNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const confirm = (k: string) => setPending((p) => new Set([...p].filter((x) => x !== k)));
  const set = (k: string, v: number | null) => {
    setMarks((m) => ({ ...m, [k]: v }));
    confirm(k);
    setSaved(false);
  };
  const given = Object.values(marks).filter((v): v is number => typeof v === "number");
  const average = given.length ? (given.reduce((a, b) => a + b, 0) / given.length).toFixed(2) : "none";

  const save = async () => {
    setError("");
    if (pending.size) return setError("Confirm or change the suggested marks first.");
    const missing = defs.find((d) => typeof marks[d.key] === "number" && (marks[d.key] as number) <= NOTE_AT && !(notes[d.key] ?? "").trim());
    if (missing) return setError(`Add a note for ${missing.label}: a mark of ${NOTE_AT} or lower needs one.`);
    setBusy(true);
    const r = await scorecardSave({ action: "rate", sessionId, staffId, marks, markNotes: notes, clientFeedback, adminNotes });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSaved(true);
    router.refresh();
  };

  return (
    <section className="rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading font-bold text-[#2C2420]">Marks</h2>
        <button
          type="button"
          onClick={() => {
            setMarks(Object.fromEntries(defs.map((d) => [d.key, 5])));
            setPending(new Set());
            setSaved(false);
          }}
          className="rounded-lg border border-[#8B9E7E] text-[#55684A] px-3 py-1.5 text-sm font-medium"
        >
          All 5s
        </button>
      </div>
      {defs.map((d) => {
        const v = marks[d.key];
        const s = suggested[d.key];
        const isPending = pending.has(d.key);
        return (
          <div key={d.key} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[#2C2420]">{d.label}</span>
              {isPending && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#FFF1D6] text-[#8A5A14]">Suggested</span>}
            </div>
            <p className="text-xs text-[#6B5D52]">{d.help}</p>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={d.label}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => set(d.key, n)}
                  aria-pressed={v === n}
                  className={`h-10 w-10 rounded-lg border text-sm font-bold ${v === n ? (isPending ? "border-[#C9A25E] bg-[#FFF1D6] text-[#8A5A14]" : "border-[#B5845A] bg-[#B5845A] text-white") : "border-[#DDD5CC] text-[#2C2420]"}`}
                >
                  {n}
                </button>
              ))}
              <button type="button" onClick={() => set(d.key, null)} aria-pressed={v === null} className={`h-10 rounded-lg border px-3 text-sm ${v === null ? "border-[#6B5D52] text-[#2C2420]" : "border-[#DDD5CC] text-[#6B5D52]"}`}>
                Blank
              </button>
              {isPending && (
                <button type="button" onClick={() => confirm(d.key)} className="h-10 rounded-lg bg-[#8A5A14] text-white px-3 text-sm">
                  Use {s?.value}
                </button>
              )}
            </div>
            {s && <p className="text-xs text-[#8A5A14]">Suggested {s.value}: {s.why}</p>}
            {typeof v === "number" && v <= NOTE_AT && (
              <textarea
                value={notes[d.key] ?? ""}
                onChange={(e) => setNotes((o) => ({ ...o, [d.key]: e.target.value }))}
                placeholder={`Why ${v}? A note is needed for 3 or lower.`}
                aria-label={`Note for ${d.label}`}
                rows={2}
                className="w-full rounded-lg border border-[#DDD5CC] px-3 py-2 text-[16px]"
              />
            )}
          </div>
        );
      })}
      <p className="text-sm text-[#2C2420]">
        Average <b>{average}</b> <span className="text-[#6B5D52]">(blanks left out)</span>
      </p>
      <label className="block text-sm text-[#2C2420]">
        Client feedback <span className="text-[#6B5D52]">(optional)</span>
        <textarea value={clientFeedback} onChange={(e) => setClientFeedback(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-[#DDD5CC] px-3 py-2 text-[16px]" />
      </label>
      <label className="block text-sm text-[#2C2420]">
        Admin notes <span className="text-[#6B5D52]">(optional)</span>
        <textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-[#DDD5CC] px-3 py-2 text-[16px]" />
      </label>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-[#B5845A] text-white px-5 py-2.5 text-sm font-medium disabled:opacity-40">
          {busy ? "Saving..." : initial ? "Save changes" : "Save rating"}
        </button>
        {saved && <span className="text-sm text-[#55684A]">Saved.</span>}
      </div>
    </section>
  );
}
