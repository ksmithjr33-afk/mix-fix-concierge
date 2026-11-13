// The client's shopping list as structured sections, read from the existing
// client shopping list email (generateClientShoppingListEmail), so what the
// client buys on each package stays exactly what that logic says. Also the
// send rules for the automatic client list: first send on completion, updated
// sends when the list changes more than six days out, the lock at six days,
// and the GHL payload fields. Pure, no database.

import { generateClientShoppingListEmail, generateShoppingList } from "@/lib/shopping-list";

type EventData = Record<string, unknown>;

/** Section headings the client email uses, in its order. */
export const CLIENT_LIST_SECTIONS = ["LIQUOR", "BEER & WINE", "MIXERS AND JUICES", "PRODUCE AND GARNISHES", "ICE & BAR SUPPLIES"] as const;

export interface ClientListSection {
  title: string;
  lines: string[]; // "Vodka — 5 bottles (750 ml) — Grey Goose or Titos"
}

export interface ClientList {
  sections: ClientListSection[];
  notes: string[]; // the paragraphs under the list: substitutions, ice
}

const SKIP_NOTES = /^(hey\b|we are very excited|please let us know|best regards)/i;

/** Runs a list generator with console.log muted: the generators log the whole event. */
export function quietly<T>(fn: () => T): T {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
}

/** The client's list for the event as it is saved now. */
export function clientList(eventData: EventData): ClientList {
  const email = quietly(() => {
    const ed = eventData as unknown as Parameters<typeof generateShoppingList>[0];
    return generateClientShoppingListEmail(generateShoppingList(ed), ed, "");
  });
  return parseClientEmail(email);
}

/** Splits the client email into its sections and its notes. */
export function parseClientEmail(email: string): ClientList {
  const sections: ClientListSection[] = [];
  const notes: string[] = [];
  let current: ClientListSection | null = null;
  for (const raw of email.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if ((CLIENT_LIST_SECTIONS as readonly string[]).includes(line)) {
      current = { title: line, lines: [] };
      sections.push(current);
      continue;
    }
    if (line.startsWith("- ") && current) {
      current.lines.push(line.slice(2).trim());
      continue;
    }
    current = null;
    if (!SKIP_NOTES.test(line)) notes.push(line);
  }
  return { sections: sections.filter((s) => s.lines.length > 0), notes };
}

export function listIsEmpty(list: ClientList): boolean {
  return list.sections.every((s) => s.lines.length === 0);
}

/** The list as plain text, for client_shopping_list_text. */
export function clientListText(list: ClientList): string {
  return list.sections.map((s) => [s.title, ...s.lines.map((l) => `- ${l}`)].join("\n")).join("\n\n");
}

export function sameList(a: ClientList | null, b: ClientList | null): boolean {
  const key = (l: ClientList | null) => JSON.stringify((l?.sections ?? []).map((s) => [s.title, s.lines]));
  return key(a) === key(b);
}

/** "Vodka" from "Vodka — 5 bottles (750 ml) — Grey Goose or Titos". */
function itemOf(line: string): string {
  return line.split(" — ")[0].trim();
}

function restOf(line: string): string {
  return line.split(" — ").slice(1).join(" — ").trim();
}

/**
 * Plain text summary of what changed between two lists, one line per item:
 * "Vodka: now 6 bottles (750 ml), was 5 bottles (750 ml)", "Added: Fireball,
 * 1 bottle (750 ml)", "Removed: Tequila blanco". Empty when nothing changed.
 */
export function listChanges(before: ClientList | null, after: ClientList): string {
  const index = (l: ClientList | null) => {
    const m = new Map<string, string>();
    for (const s of l?.sections ?? []) for (const line of s.lines) m.set(`${s.title}|${itemOf(line).toLowerCase()}`, line);
    return m;
  };
  const was = index(before);
  const now = index(after);
  const out: string[] = [];
  for (const [k, line] of now) {
    const old = was.get(k);
    if (old === undefined) out.push(`Added: ${itemOf(line)}, ${restOf(line)}`);
    else if (old !== line) out.push(`${itemOf(line)}: now ${restOf(line)}, was ${restOf(old)}`);
  }
  for (const [k, line] of was) if (!now.has(k)) out.push(`Removed: ${itemOf(line)}`);
  return out.join("\n");
}

/** A drink the client gave us their own recipe for. */
export function hasCustomRecipe(eventData: EventData): boolean {
  const drinks = Array.isArray(eventData.signature_drinks) ? eventData.signature_drinks : [];
  return drinks.some((d) => !!d && typeof d === "object" && (d as { is_custom?: unknown }).is_custom === true);
}

// ----- Send rules -----

export type ListReason = "first" | "updated" | "approved";

/** What happens to the list when the client completes intake. */
export type CompletionAction = "send_first" | "hold_custom" | "no_list";

export function completionAction(o: { customRecipe: boolean; empty: boolean }): CompletionAction {
  if (o.empty) return "no_list"; // nothing for the client to buy on this package (Beer and Wine)
  if (o.customRecipe) return "hold_custom";
  return "send_first"; // also when the event is booked inside six days
}

/** Who caused the update being delivered. */
export type UpdateMode = "client" | "admin" | "approved";

export type UpdateAction =
  | { send: true; reason: ListReason }
  | { send: false; why: "unchanged" | "locked" | "admin_unchecked" | "awaiting_review" };

/**
 * The list after an applied update:
 * - approved: an admin approved a held change, the list goes out
 * - first list still waiting for review (custom recipe): nothing goes out
 * - the list did not change: nothing goes out
 * - admin edit: goes out when the admin left "Send updated list to client" on
 * - client update: goes out more than six days out, locked inside six days
 */
export function updateAction(o: { mode: UpdateMode; released: boolean; changed: boolean; locked: boolean; adminSend?: boolean }): UpdateAction {
  if (o.mode === "approved") return o.released ? { send: true, reason: "approved" } : { send: false, why: "awaiting_review" };
  if (!o.released) return { send: false, why: "awaiting_review" };
  if (!o.changed) return { send: false, why: "unchanged" };
  if (o.mode === "admin") return o.adminSend ? { send: true, reason: "updated" } : { send: false, why: "admin_unchecked" };
  return o.locked ? { send: false, why: "locked" } : { send: true, reason: "updated" };
}

export const NOT_SENT_TEXT: Record<"unchanged" | "locked" | "admin_unchecked" | "awaiting_review", string> = {
  unchanged: "The list did not change.",
  locked: "Not sent: the list is locked within 6 days of the event.",
  admin_unchecked: "Not sent: the admin unchecked Send updated list to client.",
  awaiting_review: "Not sent: the first list is waiting for admin review.",
};

/**
 * What the client hears when a change inside six days is sent to our team as a
 * request (a drink change, or a change to their shopping list). It is not
 * saved, so it never says it was.
 */
export const CHANGE_REQUEST_MESSAGE =
  "We are within 6 days of your event, so I have sent this change to our team for approval. It is not confirmed yet, and we will text you as soon as our team approves or declines it.";

export type ChangeRequestFields = {
  change_request_pending: boolean;
  change_request_approved: boolean;
  change_request_declined: boolean;
  change_request_summary: string; // plain words, for GHL to message the client
};

/** The change request fields every update payload carries. All false and empty unless one is set. */
export function changeRequestFields(o: { pending?: boolean; approved?: boolean; declined?: boolean; summary?: string } = {}): ChangeRequestFields {
  return {
    change_request_pending: o.pending === true,
    change_request_approved: o.approved === true,
    change_request_declined: o.declined === true,
    change_request_summary: o.summary ?? "",
  };
}

export interface ClientListFields {
  client_shopping_list_send: boolean;
  client_shopping_list_reason: ListReason | "";
  client_shopping_list_changes: string;
  client_shopping_list_url: string;
  client_shopping_list_text: string;
  list_change_declined: boolean;
}

/**
 * The GHL payload fields. send is only true when auto send is on, so with the
 * switch off client_shopping_list_send is always false. reason is empty when
 * nothing is sent, and changes is empty on the first list.
 */
export function clientListFields(o: {
  enabled: boolean;
  send: boolean;
  reason: ListReason | null;
  changes: string;
  url: string;
  list: ClientList;
  declined?: boolean;
}): ClientListFields {
  const send = o.enabled && o.send;
  return {
    client_shopping_list_send: send,
    client_shopping_list_reason: send && o.reason ? o.reason : "",
    client_shopping_list_changes: send && o.reason !== "first" ? o.changes : "",
    client_shopping_list_url: o.url,
    client_shopping_list_text: clientListText(o.list),
    list_change_declined: o.declined === true,
  };
}

/** Where the client sees their list: their event page. */
export function clientListUrl(base: string, sessionId: string): string {
  return `${base}/s?id=${encodeURIComponent(sessionId)}#shopping-list`;
}

/** The admin only order sheet. */
export function orderSheetUrl(base: string, sessionId: string): string {
  return `${base}/team/admin/e/${encodeURIComponent(sessionId)}/order`;
}
