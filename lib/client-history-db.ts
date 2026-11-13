// Reads for client history (lib/client-history.ts). Server only, admins only:
// every function that returns client details takes the viewer and returns
// null for anyone who is not an admin (an admin in Bartender view is not).
//
// One light read of every session: a few fields each, never the whole event
// or the conversation, so it stays small as bookings grow.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { hiddenEventIds } from "@/lib/team/hidden";
import { siteOrigin } from "@/lib/team/clock-db";
import { clientUrls } from "@/lib/client-links";
import { chicagoToday } from "@/lib/team/time";
import {
  clientDirectory,
  clientEvents,
  clientHistory,
  emailKey,
  eventNumbers,
  type ClientRow,
  type ClientSummary,
  type HistoryEntry,
} from "@/lib/client-history";

type Viewer = { role: string };

const SELECT = [
  "id, name, email, created_at, status, event_date, package_type, guest_count, hours_booked, event_name",
  "booked_total:booked_price->>total",
  "ed_date:event_data->>event_date, ed_name:event_data->>event_name, ed_type:event_data->>event_type",
  "ed_package:event_data->>package, ed_guests:event_data->>guest_count, ed_client:event_data->>client_name",
  "client_phone:event_data->>client_phone, contact_phone:event_data->>day_of_contact_phone",
].join(", ");

const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** One row in ClientRow shape. The test database returns whole rows, so it also reads event_data and booked_price. */
function toRow(r: Record<string, unknown>): ClientRow {
  const ed = (r.event_data as Record<string, unknown> | null) ?? {};
  const bp = (r.booked_price as Record<string, unknown> | null) ?? {};
  const pick = (alias: string, key: string, from: Record<string, unknown>) => text(alias in r ? r[alias] : from[key]);
  const total = Number(pick("booked_total", "total", bp));
  return {
    id: String(r.id),
    name: text(r.name),
    email: text(r.email),
    created_at: text(r.created_at),
    status: text(r.status),
    event_date: text(r.event_date),
    package_type: text(r.package_type),
    guest_count: text(r.guest_count),
    hours_booked: text(r.hours_booked),
    event_name: text(r.event_name),
    booked_total: Number.isFinite(total) && pick("booked_total", "total", bp) !== null ? total : null,
    ed_date: pick("ed_date", "event_date", ed),
    ed_name: pick("ed_name", "event_name", ed),
    ed_type: pick("ed_type", "event_type", ed),
    ed_package: pick("ed_package", "package", ed),
    ed_guests: pick("ed_guests", "guest_count", ed),
    ed_client: pick("ed_client", "client_name", ed),
    client_phone: pick("client_phone", "client_phone", ed),
    contact_phone: pick("contact_phone", "day_of_contact_phone", ed),
  };
}

/** Every session, light. */
export async function allClientRows(): Promise<ClientRow[]> {
  const out: ClientRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("sessions").select(SELECT).order("created_at", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`client history read failed: ${error.message}`);
    const rows = (data as unknown as Record<string, unknown>[]) ?? [];
    out.push(...rows.map(toRow));
    if (rows.length < 1000) break;
  }
  return out;
}

export interface HistoryRow extends HistoryEntry {
  managerHref: string | null; // only submitted events have a manager view
  conciergeUrl: string;
  eventUrl: string;
}

export interface ClientHistoryView {
  matchedOn: string; // the email the history matched on
  rows: HistoryRow[];
}

function withLinks(entries: HistoryEntry[]): HistoryRow[] {
  const base = siteOrigin();
  return entries.map((e) => {
    const u = clientUrls(base, e.id);
    return { ...e, managerHref: e.status === "details pending" ? null : `/team/admin/e/${encodeURIComponent(e.id)}`, conciergeUrl: u.conciergeUrl, eventUrl: u.eventUrl };
  });
}

/** The Client history card on the manager view's Details tab. Null unless the viewer is an admin. */
export async function historyFor(session: Pick<SessionRow, "id">, viewer: Viewer, today: string = chicagoToday()): Promise<ClientHistoryView | null> {
  if (viewer.role !== "admin") return null;
  const [rows, hidden] = await Promise.all([allClientRows(), hiddenEventIds()]);
  const target = rows.find((r) => r.id === session.id);
  if (!target) return { matchedOn: "", rows: [] };
  return { matchedOn: emailKey(target.email) ?? "", rows: withLinks(clientHistory(target, rows, hidden, today)) };
}

/**
 * Which booking this is for the client (1 for the first), for the manager view
 * header. Reads only this email's sessions, so every tab stays fast. Null
 * unless the viewer is an admin.
 */
export async function eventNumberFor(session: Pick<SessionRow, "id" | "email">, viewer: Viewer): Promise<number | null> {
  if (viewer.role !== "admin") return null;
  const key = emailKey(session.email);
  if (!key) return 1;
  // ilike ignores case; % and _ in the email are escaped so they match only themselves.
  const pattern = `%${key.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { data, error } = await supabase.from("sessions").select("id, email, created_at").ilike("email", pattern);
  if (error) throw new Error(`repeat client read failed: ${error.message}`);
  const same = ((data as { id: string; email: string | null; created_at: string | null }[]) ?? []).filter((r) => emailKey(r.email) === key);
  return eventNumbers(same.map((r) => toRow(r))).get(session.id) ?? 1;
}

/** Booking numbers for every session, for the admin events list and calendar. Null unless admin. */
export async function eventNumbersFor(viewer: Viewer, rows?: ClientRow[]): Promise<Map<string, number> | null> {
  if (viewer.role !== "admin") return null;
  return eventNumbers(rows ?? (await allClientRows()));
}

/** The Clients page. Null unless the viewer is an admin. */
export async function clientsList(viewer: Viewer, today: string = chicagoToday()): Promise<ClientSummary[] | null> {
  if (viewer.role !== "admin") return null;
  return clientDirectory(await allClientRows(), today);
}

export interface ClientPage {
  client: ClientSummary;
  rows: HistoryRow[];
}

/** One client's full event list, by email key. Null unless admin; "none" when no session has that email. */
export async function clientPage(key: string, viewer: Viewer, today: string = chicagoToday()): Promise<ClientPage | null | "none"> {
  if (viewer.role !== "admin") return null;
  const [rows, hidden] = await Promise.all([allClientRows(), hiddenEventIds()]);
  const mine = rows.filter((r) => emailKey(r.email) === key);
  if (mine.length === 0) return "none";
  const client = clientDirectory(mine, today)[0];
  return { client, rows: withLinks(clientEvents(mine, hidden, today)) };
}
