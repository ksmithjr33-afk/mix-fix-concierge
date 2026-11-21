// Team notes and the client's view of an event. Pure, no database.
//
// event_data.special_requests holds only what the client asked for. Anything
// the system or staff writes for our team goes in event_data.team_notes, which
// the client page never reads. An extra drink the client named past their
// package count, with nobody saying yes to the $50, is kept whole in
// event_data.unconfirmed_drinks so the client can answer Yes or No on their
// page.
//
// The team side (event view, events row, GHL webhook, the summary) keeps
// showing special requests and team notes together, exactly as before:
// teamRequestsText. The client page, the update concierge and anything sent
// to the browser get clientEventData, which has neither internal field.

import { isBlank } from "@/lib/blank";

export const TEAM_NOTES = "team_notes";
export const UNCONFIRMED_DRINKS = "unconfirmed_drinks";
/** Fields only our team reads. Never sent to the client's browser. */
export const INTERNAL_FIELDS = [TEAM_NOTES, UNCONFIRMED_DRINKS] as const;

/**
 * Sent with signature_drinks when the client said yes to the extra drink
 * question on their page: the drinks past the package count are added and
 * priced, instead of becoming a manager request. Never saved, and never taken
 * from the concierge's tool input.
 */
export const ACCEPT_EXTRA_DRINKS = "accept_extra_drinks";

/** The price the client is quoted for each drink past the package count. */
export const EXTRA_DRINK_PRICE = 50;

type EventData = Record<string, unknown>;

const NOT_FINALIZED_PREFIX = "Drinks not finalized:";
const NOT_CONFIRMED_PREFIX = "Not confirmed:";

/** A line the system wrote for our team. Older events have these inside special_requests. */
export function isTeamNoteLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith(NOT_FINALIZED_PREFIX) || t.startsWith(NOT_CONFIRMED_PREFIX);
}

const lines = (v: unknown): string[] =>
  typeof v === "string" && !isBlank(v) ? v.split("\n").map((l) => l.trim()).filter(Boolean) : [];

/** Splits special requests into what the client asked for and the team note lines mixed into it. */
export function splitTeamNotes(special: unknown): { requests: string; notes: string[] } {
  const all = lines(special);
  return { requests: all.filter((l) => !isTeamNoteLine(l)).join("\n"), notes: all.filter(isTeamNoteLine) };
}

/** Special requests as the client sees them: only what they asked for. */
export function clientRequests(ed: EventData): string {
  return splitTeamNotes(ed.special_requests).requests;
}

/** Special requests plus team notes, the way the team side has always shown them. */
export function teamRequestsText(ed: EventData): string {
  const notes = lines(ed[TEAM_NOTES]);
  const special = typeof ed.special_requests === "string" && !isBlank(ed.special_requests) ? ed.special_requests.trim() : "";
  return [special, ...notes.filter((n) => !special.includes(n))].filter(Boolean).join("\n");
}

/** Adds lines to the team notes, leaving out ones already there. */
export function withTeamNotes(ed: EventData, add: string[]): EventData {
  const have = lines(ed[TEAM_NOTES]);
  const next = [...have, ...add.filter((l) => l && !have.includes(l))];
  const out = { ...ed };
  if (next.length) out[TEAM_NOTES] = next.join("\n");
  else delete out[TEAM_NOTES];
  return out;
}

/** Takes out the team note lines that start with a prefix. */
function dropNotes(ed: EventData, prefix: string): EventData {
  const kept = lines(ed[TEAM_NOTES]).filter((l) => !l.startsWith(prefix));
  const out = { ...ed };
  if (kept.length) out[TEAM_NOTES] = kept.join("\n");
  else delete out[TEAM_NOTES];
  return out;
}

export function notFinalizedNote(named: string[]): string {
  return `${NOT_FINALIZED_PREFIX} ${named.length ? `the client named ${named.join(", ")}` : "no drinks picked yet"}. Text them to finish the menu.`;
}

export function notConfirmedNote(names: string[]): string {
  return `${NOT_CONFIRMED_PREFIX} ${names.join(", ")} as ${names.length === 1 ? "an additional drink" : "additional drinks"} ($${EXTRA_DRINK_PRICE} each). Ask the client before adding.`;
}

/** The drink names in an older "Not confirmed: A, B as additional drinks ($50 each)..." line. */
export function namesInNotConfirmed(line: string): string[] {
  const m = line.trim().match(/^Not confirmed:\s*(.+?)\s+as an? additional drinks?\b|^Not confirmed:\s*(.+?)\s+as additional drinks\b/);
  const list = m ? (m[1] ?? m[2] ?? "") : "";
  return list.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Moves the team note lines out of special_requests into team_notes, and an
 * older "Not confirmed" line's drinks into unconfirmed_drinks (names only: the
 * recipe was not kept back then). Returns null when there is nothing to move.
 */
export function moveTeamNotes(ed: EventData): EventData | null {
  const { requests, notes } = splitTeamNotes(ed.special_requests);
  if (notes.length === 0) return null;
  let out: EventData = { ...ed };
  if (requests) out.special_requests = requests;
  else delete out.special_requests;
  out = withTeamNotes(out, notes);
  const have = Array.isArray(ed[UNCONFIRMED_DRINKS]) ? (ed[UNCONFIRMED_DRINKS] as unknown[]) : [];
  if (have.length === 0) {
    const names = notes.filter((n) => n.startsWith(NOT_CONFIRMED_PREFIX)).flatMap(namesInNotConfirmed);
    if (names.length) out[UNCONFIRMED_DRINKS] = names.map((name) => ({ name }));
  }
  return out;
}

const drinkName = (d: unknown): string => {
  const n = (d as { name?: unknown; menu_name?: unknown })?.name ?? (d as { menu_name?: unknown })?.menu_name;
  return typeof n === "string" ? n.trim() : "";
};

export function hasRecipe(d: unknown): boolean {
  const ing = (d as { ingredients?: unknown })?.ingredients;
  return Array.isArray(ing) ? ing.some((x) => !isBlank(x)) : !isBlank(ing);
}

/** The extra drinks waiting for the client's Yes or No. */
export function unconfirmedDrinks(ed: EventData): Record<string, unknown>[] {
  const list = Array.isArray(ed[UNCONFIRMED_DRINKS]) ? (ed[UNCONFIRMED_DRINKS] as unknown[]) : [];
  return list.filter((d): d is Record<string, unknown> => !!d && typeof d === "object" && drinkName(d) !== "");
}

/**
 * After a saved change: once every drink has its recipe, the menu is finished,
 * so drinks_not_finalized and its team note come off.
 */
export function settleDrinkFlags(ed: EventData): EventData {
  if (ed.drinks_not_finalized !== true) return ed;
  const drinks = Array.isArray(ed.signature_drinks) ? (ed.signature_drinks as unknown[]) : [];
  if (drinks.length === 0 || !drinks.every(hasRecipe)) return ed;
  const out = dropNotes(ed, NOT_FINALIZED_PREFIX);
  delete out.drinks_not_finalized;
  return out;
}

/** After the client answered the extra drink question: the drinks and their note come off. */
export function clearUnconfirmed(ed: EventData, answer: string): EventData {
  const out = dropNotes(ed, NOT_CONFIRMED_PREFIX);
  delete out[UNCONFIRMED_DRINKS];
  return withTeamNotes(out, answer ? [answer] : []);
}

/** The event as the client's browser gets it: no team notes, no held drinks, no team lines in special requests. */
export function clientEventData(ed: EventData | null | undefined): EventData {
  const out: EventData = { ...(ed ?? {}) };
  for (const k of INTERNAL_FIELDS) delete out[k];
  if (typeof out.special_requests === "string") {
    const requests = clientRequests(out);
    if (requests) out.special_requests = requests;
    else delete out.special_requests;
  }
  return out;
}

/** What the client still has to answer, written for their page. */
export interface ClientAsks {
  drinksUnfinished: boolean;
  extraDrinks: string[]; // names of the drinks past the package count
  included: number; // drinks the package includes
  ordinal: string; // "4th": the first extra drink's place on the menu
  price: number; // each
}

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export function clientAsks(ed: EventData, included: number): ClientAsks {
  const extraDrinks = unconfirmedDrinks(ed).map(drinkName);
  return {
    drinksUnfinished: ed.drinks_not_finalized === true,
    extraDrinks,
    included,
    ordinal: ordinal(included + 1),
    price: EXTRA_DRINK_PRICE,
  };
}

/** The question on the client page. */
export function extraDrinkQuestion(a: ClientAsks): string {
  if (a.extraDrinks.length === 0) return "";
  const names = a.extraDrinks.join(" and ");
  if (a.extraDrinks.length === 1) {
    return `You named a ${a.ordinal} drink: ${names}. Your package includes ${a.included}. Add it for $${a.price}?`;
  }
  return `You named ${a.extraDrinks.length} more drinks: ${names}. Your package includes ${a.included}. Add them for $${a.price} each?`;
}

export const DRINKS_UNFINISHED_LINE = "Your drink menu is not finished yet.";
export const FINISH_DRINKS_BUTTON = "Finish my drink menu";
/** What the Finish button sends in the chat. */
export const FINISH_DRINKS_MESSAGE = "I would like to finish my drink menu.";

/**
 * The event as the team side and GHL have always had it: special requests and
 * team notes together in special_requests, and no internal keys.
 */
export function teamEventData<T extends EventData>(ed: T): T {
  if (!ed || typeof ed !== "object") return ed;
  const has = INTERNAL_FIELDS.some((k) => k in ed);
  if (!has) return ed;
  const out: EventData = { ...ed };
  for (const k of INTERNAL_FIELDS) delete out[k];
  const joined = teamRequestsText(ed);
  if (joined) out.special_requests = joined;
  return out as T;
}
