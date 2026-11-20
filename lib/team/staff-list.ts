// The staff "Shopping list for this event" on its own Shopping list tab (right
// after Supplies), and what staff tell us about each line. Pure, no database.
//
// Ready: the list has lines, and more than half our lines have a source
// (listReady) or a ready text already went out for the event. Before then, or
// when the list cannot be built, the tab still shows and says it is not ready yet.
//
// One list, never a copy: the lines are the admin Shopping list's own lines
// (lib/order-sheet.ts buildSheet, read through staffSheet), grouped by each
// line's source in plain words instead of colors:
//   Bring from your supply · Being delivered (per source) · Pick up (per store)
//   · The client is buying (read only) · Not decided yet
// A source's kind (supply, delivery, pickup) is set on Manage stores, or comes
// from its name (lib/order-sheet-shared.ts storeKind).
//
// Staff see the item and the amount only: never a price, a cost, a supplier
// link, the brand note, or who placed an order. A delivery line says whether it
// is ordered yet.
//
// What staff can say, each with who and when, each undoable, plus an optional
// note of up to 80 characters:
//   supply line: "I have it" (have) or "I'm out" (out)
//   delivery or pick up line: "I already have this" (have)
// Admins see the answers on their Shopping list tab. An "I'm out" on a supply
// line counts on the tab badge until the line's source changes or an admin
// dismisses it.

import { amountText, storeKind, type Store, type StoreInfo } from "@/lib/order-sheet-shared";
import type { Sheet, SheetLine } from "@/lib/order-sheet";

export const LIST_TITLE = "Shopping list for this event";
export const LIST_INTRO = "Mark what you already have so we do not buy it twice.";
export const LIST_READ_ONLY = "This event is over, so the list is read only.";
export const LIST_PREVIEW = "You are viewing this as a bartender. Only people who accepted the event can answer.";
export const NOTE_MAX = 80;
export const LIST_TAB = "Shopping list";
export const LIST_NOT_READY = "The shopping list is not ready yet. You will get a text when it is.";
export const LIST_MOVED = "Looking for the shopping list? It has its own tab now.";
export const LIST_MOVED_BUTTON = "Open the Shopping list";

/** The staff event page on the Shopping list tab: the link in the ready text. */
export function listLink(origin: string, sessionId: string): string {
  return `${origin}/team/e/${encodeURIComponent(sessionId)}?tab=list`;
}

export type GroupId = "supply" | "delivery" | "pickup" | "client" | "undecided";
export type Answer = "have" | "out";

export const GROUP_TITLES: Record<GroupId, string> = {
  supply: "Bring from your supply",
  delivery: "Being delivered",
  pickup: "Pick up",
  client: "The client is buying",
  undecided: "Not decided yet",
};
const GROUP_ORDER: GroupId[] = ["supply", "delivery", "pickup", "client", "undecided"];

export const BUTTONS = { have: "I have it", out: "I'm out", alreadyHave: "I already have this", undo: "Undo" } as const;

/** One saved answer (order_sheet_answers). */
export interface AnswerRow {
  session_id: string;
  line_ref: string;
  staff_id: string;
  answer: Answer | null;
  note: string;
  store: Store | null; // the line's store when they answered
  dismissed_at: string | null;
  dismissed_by_name: string | null;
  updated_at: string;
}

/** Which group a line falls under. */
export function groupOf(line: Pick<SheetLine, "clientBuys" | "store">, stores: StoreInfo[]): GroupId {
  if (line.clientBuys) return "client";
  const s = line.store ? stores.find((x) => x.id === line.store) : undefined;
  if (!s) return "undecided";
  return storeKind(s);
}

/** What a person may say on a line in this group. */
export function answersFor(group: GroupId): Answer[] {
  return group === "supply" ? ["have", "out"] : group === "delivery" || group === "pickup" ? ["have"] : [];
}

/** A note may go on any line staff can answer, and on lines not decided yet. */
export function notesFor(group: GroupId): boolean {
  return group !== "client";
}

export function cleanNote(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
}

const first = (name: string | undefined) => String(name ?? "").trim().split(/\s+/)[0] || "Someone";

/** "Jayde has this", "Jayde is out". */
export function answerText(name: string, answer: Answer): string {
  return answer === "out" ? `${first(name)} is out` : `${first(name)} has this`;
}

// ----- What staff see -----

export interface StaffLineView {
  ref: string;
  item: string;
  quantity: string;
  ordered: "Ordered" | "Not ordered yet" | null; // delivery lines only
  answers: Answer[]; // the buttons
  notes: boolean;
  mine: { answer: Answer | null; note: string; at: string } | null;
  teammates: string[]; // "Jayde has this", "Sam is out: only one bottle"
}

export interface StaffSubgroup {
  title: string; // the store name
  color: string;
  count: number;
  lines: StaffLineView[];
}

export interface StaffGroup {
  id: GroupId;
  title: string;
  count: number;
  color: string | null; // the swatch next to the heading, when the group has one source
  subgroups: StaffSubgroup[]; // delivery and pick up: one per source; supply only with more than one source
  lines: StaffLineView[]; // lines not under a sub heading
}

export interface StaffListView {
  sessionId: string;
  groups: StaffGroup[]; // only groups with lines, in the fixed order
  total: number;
  canAnswer: boolean;
  readOnlyNote: string; // "" when they can answer
  ready: boolean; // false: the tab shows LIST_NOT_READY instead of the lines
}

function staffLine(l: SheetLine, group: GroupId, rows: AnswerRow[], viewerId: string, names: Map<string, string>): StaffLineView {
  const mine = rows.find((r) => r.staff_id === viewerId);
  const others = rows.filter((r) => r.staff_id !== viewerId && (r.answer || r.note));
  return {
    ref: l.ref,
    item: l.fields.name,
    quantity: amountText(l.fields, l.section),
    ordered: group === "delivery" ? (l.ordered ? "Ordered" : "Not ordered yet") : null,
    answers: answersFor(group),
    notes: notesFor(group),
    mine: mine && (mine.answer || mine.note) ? { answer: mine.answer, note: mine.note, at: mine.updated_at } : null,
    teammates: others.map((r) => {
      const who = first(names.get(r.staff_id));
      const said = r.answer ? answerText(who, r.answer) : `${who} left a note`;
      return r.note ? `${said}: ${r.note}` : said;
    }),
  };
}

/** The staff list: the sheet's lines under plain headings, with this viewer's answers and their teammates' by first name. */
export function staffList(o: {
  sessionId: string;
  sheet: Sheet;
  stores: StoreInfo[];
  answers: AnswerRow[];
  names: Map<string, string>; // staff id to name, first names are taken from it
  viewerId: string;
  canAnswer: boolean;
  readOnlyNote: string;
  textSent?: boolean; // a ready text already went out for this event
}): StaffListView {
  const lines = o.sheet.sections.flatMap((s) => s.lines);
  const byRef = new Map<string, AnswerRow[]>();
  for (const a of o.answers) byRef.set(a.line_ref, [...(byRef.get(a.line_ref) ?? []), a]);
  const ordered = [...o.stores].sort((a, b) => a.position - b.position);
  const groups: StaffGroup[] = [];
  for (const id of GROUP_ORDER) {
    const mine = lines.filter((l) => groupOf(l, o.stores) === id);
    if (mine.length === 0) continue;
    const view = (l: SheetLine) => staffLine(l, id, byRef.get(l.ref) ?? [], o.viewerId, o.names);
    const sources = id === "supply" || id === "delivery" || id === "pickup" ? ordered.filter((s) => mine.some((l) => l.store === s.id)) : [];
    const split = id === "delivery" || id === "pickup" || sources.length > 1;
    groups.push({
      id,
      title: GROUP_TITLES[id],
      count: mine.length,
      color: sources.length === 1 ? sources[0].color : null,
      subgroups: split
        ? sources.map((s) => {
            const ls = mine.filter((l) => l.store === s.id).map(view);
            return { title: s.name, color: s.color, count: ls.length, lines: ls };
          })
        : [],
      lines: split ? [] : mine.map(view),
    });
  }
  return { sessionId: o.sessionId, groups, total: lines.length, canAnswer: o.canAnswer, readOnlyNote: o.readOnlyNote, ready: lines.length > 0 && (!!o.textSent || listReady(o.sheet)) };
}

/** The tab with the not ready line: before there is a list, or when it could not be built. */
export function notReadyView(o: { sessionId: string; canAnswer?: boolean; readOnlyNote?: string }): StaffListView {
  return { sessionId: o.sessionId, groups: [], total: 0, canAnswer: !!o.canAnswer, readOnlyNote: o.readOnlyNote ?? "", ready: false };
}

/** Every line in the staff list, in order, for checking it matches the sheet. */
export function staffListLines(v: StaffListView): StaffLineView[] {
  return v.groups.flatMap((g) => [...g.lines, ...g.subgroups.flatMap((s) => s.lines)]);
}

// ----- Saving an answer -----

export type AnswerChange = { ok: true; answer: Answer | null; note: string } | { ok: false; error: string };

/** A change from the staff form. answer null is Undo. note undefined keeps the saved note. */
export function cleanAnswer(group: GroupId, raw: { answer?: unknown; note?: unknown }, saved: Pick<AnswerRow, "answer" | "note"> | null): AnswerChange {
  const answer = raw.answer === undefined ? (saved?.answer ?? null) : raw.answer === null || raw.answer === "" ? null : raw.answer;
  if (answer !== null && answer !== "have" && answer !== "out") return { ok: false, error: "Pick an answer." };
  if (answer !== null && !answersFor(group).includes(answer)) return { ok: false, error: group === "client" ? "The client is buying this one." : "That answer does not fit this line." };
  if (raw.note !== undefined && !notesFor(group)) return { ok: false, error: "The client is buying this one." };
  const note = raw.note === undefined ? (saved?.note ?? "") : cleanNote(raw.note);
  return { ok: true, answer, note };
}

// ----- What admins see -----

export interface AdminAnswer {
  staffId: string;
  text: string; // "Jayde has this", "Jayde is out"
  tone: "have" | "out" | "handled"; // green, red, gray (an out the admin handled)
  note: string;
  at: string;
  canDismiss: boolean; // an open "I'm out" on a supply line
}

export interface AdminLineAnswers {
  answers: AdminAnswer[];
  notes: string[]; // notes left without an answer: "Sam: brought extra"
  skip: boolean; // "Skip ordering": someone has it and the line is not ordered yet
}

export interface AdminAnswers {
  byRef: Record<string, AdminLineAnswers>;
  out: number; // lines with an open "I'm out"
  have: number; // lines someone already has
  summary: string; // "2 out, 3 already have", "" when nobody answered
  badge: number; // open "I'm out" answers on supply lines
  supplyStore: Store | null; // where "Skip ordering" moves a line
}

/** An "I'm out" still waiting on an admin: on a supply line, the line's source unchanged, not dismissed. */
export function openOut(a: AnswerRow, line: SheetLine | undefined, stores: StoreInfo[]): boolean {
  return a.answer === "out" && !a.dismissed_at && !!line && groupOf(line, stores) === "supply" && line.store === a.store;
}

export function adminAnswers(sheet: Sheet, stores: StoreInfo[], rows: AnswerRow[], names: Map<string, string>): AdminAnswers {
  const lines = new Map(sheet.sections.flatMap((s) => s.lines).map((l) => [l.ref, l]));
  const byRef: Record<string, AdminLineAnswers> = {};
  let badge = 0;
  for (const r of rows) {
    const line = lines.get(r.line_ref);
    if (!line) continue;
    const entry = (byRef[r.line_ref] ??= { answers: [], notes: [], skip: false });
    const who = first(names.get(r.staff_id));
    if (!r.answer) {
      if (r.note) entry.notes.push(`${who}: ${r.note}`);
      continue;
    }
    const open = openOut(r, line, stores);
    if (open) badge++;
    entry.answers.push({
      staffId: r.staff_id,
      text: answerText(who, r.answer),
      tone: r.answer === "have" ? "have" : open ? "out" : "handled",
      note: r.note,
      at: r.updated_at,
      canDismiss: open,
    });
    const group = groupOf(line, stores);
    if (r.answer === "have" && (group === "delivery" || group === "pickup") && !line.ordered) entry.skip = true;
  }
  const refs = Object.entries(byRef);
  const out = refs.filter(([, e]) => e.answers.some((a) => a.tone === "out")).length;
  const have = refs.filter(([, e]) => e.answers.some((a) => a.tone === "have")).length;
  return {
    byRef,
    out,
    have,
    summary: out || have ? `${out} out, ${have} already have` : "",
    badge,
    supplyStore: [...stores].sort((a, b) => a.position - b.position).find((s) => !s.retired && storeKind(s) === "supply")?.id ?? null,
  };
}

// ----- The "list is ready" text -----

/** Ready when most of the lines we buy have a source: more than half. */
export function listReady(sheet: Sheet): boolean {
  const ours = sheet.sections.flatMap((s) => s.lines).filter((l) => !l.clientBuys);
  return ours.length > 0 && ours.filter((l) => l.store).length * 2 > ours.length;
}

/** "The shopping list for Justin's Wedding, Sat, Dec 20 is ready. Open it and mark what you already have: <link>" */
export function readyText(o: { title: string; date: string; link: string }): string {
  return `The shopping list for ${o.title}, ${o.date} is ready. Open it and mark what you already have: ${o.link}`;
}
