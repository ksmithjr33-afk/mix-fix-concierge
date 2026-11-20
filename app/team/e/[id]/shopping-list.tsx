"use client";

import { useState } from "react";
import { BUTTONS, LIST_INTRO, LIST_TITLE, NOTE_MAX, type StaffGroup, type StaffLineView, type StaffListView } from "@/lib/team/staff-list";

// "Shopping list for this event" on the Supplies tab: the admin Shopping list's
// own lines, under plain headings by source, with a small swatch so it matches
// the admin sheet. Item and amount only. People who accepted the event say what
// they already have; everything else about a line is the admin's.

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";

function Swatch({ color }: { color: string | null }) {
  if (!color) return null;
  return <span aria-hidden className="inline-block h-3 w-4 shrink-0 rounded-[3px] border border-black/20 align-[-0.1em]" style={{ background: color }} />;
}

function LineRow({ line, canAnswer, onSave, busy }: { line: StaffLineView; canAnswer: boolean; onSave: (ref: string, body: { answer?: "have" | "out" | null; note?: string }) => Promise<boolean>; busy: boolean }) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState(line.mine?.note ?? "");
  const mine = line.mine?.answer ?? null;
  const label = (a: "have" | "out") => (a === "out" ? BUTTONS.out : line.answers.length === 1 ? BUTTONS.alreadyHave : BUTTONS.have);
  return (
    <li className="py-2 border-b border-[#DDD5CC] last:border-0" data-ref={line.ref}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-[15px] text-[#2C2420] break-words">
          {line.item}
          {line.quantity && <span className="text-[#6B5D52]"> · {line.quantity}</span>}
        </p>
        {line.ordered && <span className={`text-sm ${line.ordered === "Ordered" ? "text-[#55684A]" : "text-[#8A4B12]"}`}>{line.ordered}</span>}
      </div>
      {line.teammates.length > 0 && <p className="text-sm text-[#6B5D52] break-words">{line.teammates.join(" · ")}</p>}
      {mine && (
        <p className={`text-sm font-medium ${mine === "out" ? "text-[#A0412D]" : "text-[#55684A]"}`}>
          You said: {label(mine)}
          {canAnswer && (
            <button type="button" disabled={busy} onClick={() => onSave(line.ref, { answer: null })} className="ml-2 font-normal text-[#9A7049] underline disabled:opacity-40">
              {BUTTONS.undo}
            </button>
          )}
        </p>
      )}
      {line.mine?.note && !noting && <p className="text-sm text-[#6B5D52] break-words">Your note: {line.mine.note}</p>}
      {canAnswer && (line.answers.length > 0 || line.notes) && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {line.answers
            .filter((a) => a !== mine)
            .map((a) => (
              <button
                key={a}
                type="button"
                disabled={busy}
                onClick={() => onSave(line.ref, { answer: a })}
                className={`rounded-lg border px-3 py-1 text-sm font-medium disabled:opacity-40 ${a === "out" ? "border-[#A0412D] text-[#A0412D]" : "border-[#55684A] text-[#55684A]"}`}
              >
                {label(a)}
              </button>
            ))}
          {line.notes && !noting && (
            <button type="button" onClick={() => setNoting(true)} className="text-sm text-[#9A7049] underline">
              {line.mine?.note ? "Change note" : "Add a note"}
            </button>
          )}
        </div>
      )}
      {noting && (
        <form
          className="mt-1 flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onSave(line.ref, { note })) setNoting(false);
          }}
        >
          <input
            autoFocus
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            aria-label={`Note for ${line.item}`}
            className="min-w-0 flex-1 rounded-lg border border-[#DDD5CC] bg-white px-2 py-1 text-[15px]"
          />
          <span className="text-xs text-[#A39585]">{note.length}/{NOTE_MAX}</span>
          <button type="submit" disabled={busy} className="rounded-lg bg-[#B5845A] text-white px-3 py-1 text-sm font-medium disabled:opacity-40">
            Save
          </button>
          <button type="button" onClick={() => { setNote(line.mine?.note ?? ""); setNoting(false); }} className="text-sm text-[#6B5D52] underline">
            Cancel
          </button>
        </form>
      )}
    </li>
  );
}

function Group({ g, canAnswer, onSave, busy }: { g: StaffGroup; canAnswer: boolean; onSave: (ref: string, body: { answer?: "have" | "out" | null; note?: string }) => Promise<boolean>; busy: boolean }) {
  const rows = (lines: StaffLineView[]) => (
    <ul>
      {lines.map((l) => (
        <LineRow key={l.ref} line={l} canAnswer={canAnswer && g.id !== "client"} onSave={onSave} busy={busy} />
      ))}
    </ul>
  );
  return (
    <section className={card} aria-label={g.title} data-group={g.id}>
      <h3 className="font-heading text-base font-bold text-[#2C2420] flex items-center gap-2">
        <Swatch color={g.color} />
        {g.title} ({g.count})
      </h3>
      {g.id === "client" && <p className="text-sm text-[#6B5D52]">For reference. The client buys these.</p>}
      {g.lines.length > 0 && rows(g.lines)}
      {g.subgroups.map((s) => (
        <div key={s.title} className="mt-2">
          <h4 className="text-[15px] font-semibold text-[#2C2420] flex items-center gap-2">
            <Swatch color={s.color} />
            {s.title} ({s.count})
          </h4>
          {rows(s.lines)}
        </div>
      ))}
    </section>
  );
}

export default function ShoppingList({ initial }: { initial: StaffListView }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (ref: string, body: { answer?: "have" | "out" | null; note?: string }) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/shopping-list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: view.sessionId, ref, ...body }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setView(d.view);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3" aria-label={LIST_TITLE} data-staff-shopping-list>
      <div className="px-1">
        <h2 className="font-heading text-xl font-bold text-[#2C2420]">{LIST_TITLE}</h2>
        <p className="text-[15px] text-[#6B5D52]">{view.readOnlyNote || LIST_INTRO}</p>
      </div>
      {error && <p className="text-sm text-[#A0412D] px-1">{error}</p>}
      {view.groups.length === 0 ? (
        <p className={`${card} text-sm text-[#6B5D52]`}>Nothing on the shopping list yet.</p>
      ) : (
        view.groups.map((g) => <Group key={g.id} g={g} canAnswer={view.canAnswer} onSave={save} busy={busy} />)
      )}
    </div>
  );
}
