// Database side of "Running low". Server only. Rules and wording in
// lib/team/low-stock.ts.
//
// Who sees what is enforced here, not in the pages: staff only ever get their
// own reports; admins and managers get all of them and are the only ones who
// can take ("On it") or close ("Resolved") a report.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { alertAdmins } from "@/lib/team/events";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { adminEventTitle, eventTitle } from "@/lib/team/event-list";
import { eventData } from "@/lib/team/markets";
import { claimNotice, siteOrigin } from "@/lib/team/clock-db";
import { sendStaffText } from "@/lib/team/sms";
import { isAdminRole } from "@/lib/team/roles";
import { checklistFor } from "@/lib/team/checklist-config";
import { allSupplies } from "@/lib/team/supplies";
import { staffSupplies } from "@/lib/team/supplies-db";
import {
  cleanText,
  eventAlertText,
  isLevel,
  itemChoices,
  kindFor,
  kitSummaryText,
  MAX_ITEM,
  MAX_NOTE,
  onItText,
  SAME_REPORT_MS,
  sameReport,
  summaryDue,
  summaryKey,
  textsAgain,
  type Level,
  type LowStockRow,
  type ReportKind,
  type ReportStatus,
} from "@/lib/team/low-stock";

const TABLE = "low_stock_reports";

export const reportLink = (id: string) => `${siteOrigin()}/team/admin/running-low#r-${id}`;

/** What one viewer sees of a report. Event titles are first name only for staff. */
export interface LowStockView {
  id: string;
  sessionId: string | null;
  eventTitle: string; // "" for kit reports
  eventHref: string | null;
  staffId: string;
  staffName: string;
  item: string;
  level: Level;
  note: string;
  kind: ReportKind;
  status: ReportStatus;
  takenBy: string; // first name, "" when nobody has it
  takenAt: string | null;
  resolvedBy: string;
  resolvedAt: string | null;
  createdAt: string;
}

/** The names to pick from on an event: its Tools lines and Supplies items. */
export async function eventItemChoices(session: SessionRow): Promise<string[]> {
  const ed = session.event_data ?? {};
  const tools = checklistFor(ed.package ?? session.package_type).flatMap((g) => g.sections.flatMap((s) => s.lines.filter((l) => !l.info).map((l) => l.label)));
  const supplies = allSupplies((await staffSupplies(session)).list).map((i) => i.item);
  return itemChoices(tools, supplies);
}

/** The names to pick from on the Me page, with no event: the Tools list. */
export function kitItemChoices(): string[] {
  return itemChoices(checklistFor("").flatMap((g) => g.sections.flatMap((s) => s.lines.filter((l) => !l.info).map((l) => l.label))), []);
}

async function textAdmins(message: string): Promise<number> {
  const admins = await alertAdmins();
  const sent = await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
  return sent.filter(Boolean).length;
}

export type SubmitResult =
  | { ok: true; id: string; kind: ReportKind; updated: boolean; texted: number }
  | { ok: false; error: string; status: number };

/**
 * Save a report. session is the event it is for (already checked: the person
 * is on it), or null for a kit report from the Me page. An event report that
 * is not happening today is saved as a kit report.
 */
export async function submitReport(
  staff: StaffMember,
  session: SessionRow | null,
  input: { item: unknown; level: unknown; note: unknown },
  now: Date = new Date()
): Promise<SubmitResult> {
  const item = cleanText(input.item, MAX_ITEM);
  if (!item) return { ok: false, error: "Pick or type an item.", status: 400 };
  const level: Level = isLevel(input.level) ? input.level : "low";
  const note = cleanText(input.note, MAX_NOTE);
  const ed = session ? eventData(session) : null;
  const kind = kindFor(!!session, ed, now);
  const sessionId = session?.id ?? null;

  // The same person, item and event inside 30 minutes: update, and text again only when it went from low to out.
  let q = supabase
    .from(TABLE)
    .select("*")
    .eq("staff_id", staff.id)
    .neq("status", "resolved")
    .gte("created_at", new Date(now.getTime() - SAME_REPORT_MS).toISOString());
  q = sessionId ? q.eq("session_id", sessionId) : q.is("session_id", null);
  const { data: recent, error: readError } = await q;
  if (readError) throw new Error(`${TABLE} lookup failed: ${readError.message}`);
  const existing = sameReport((recent as LowStockRow[]) ?? [], { staffId: staff.id, sessionId, item }, now);

  let id: string;
  let texts = false;
  let nowOut = false;
  if (existing) {
    const { error } = await supabase
      .from(TABLE)
      .update({ level, note: note || existing.note || "" })
      .eq("id", existing.id);
    if (error) throw new Error(`${TABLE} update failed: ${error.message}`);
    id = existing.id;
    texts = existing.kind === "event" && textsAgain(existing.level, level);
    nowOut = texts;
  } else {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({ session_id: sessionId, staff_id: staff.id, item, level, note, kind, status: "open", created_at: now.toISOString() })
      .select("id")
      .single();
    if (error || !data) throw new Error(`${TABLE} insert failed: ${error?.message ?? "no row"}`);
    id = (data as { id: string }).id;
    texts = kind === "event";
  }

  let texted = 0;
  if (texts && ed) {
    // Right away, quiet hours or not: someone may need to run supplies.
    texted = await textAdmins(
      eventAlertText({ who: staff.name || "A bartender", title: eventTitle(ed), item, level, note: note || existing?.note || "", link: reportLink(id), nowOut })
    );
  }
  console.log(`[team] running low ${kind} ${existing ? "update" : "report"} ${id} from ${staff.id}: ${texted} texts`);
  return { ok: true, id, kind: existing?.kind ?? kind, updated: !!existing, texted };
}

/** Rows to views: names from staff, event titles from sessions (full name for admins, first name for everyone else). */
async function toViews(rows: LowStockRow[], admin: boolean): Promise<LowStockView[]> {
  if (rows.length === 0) return [];
  const staffIds = [...new Set(rows.flatMap((r) => [r.staff_id, r.taken_by, r.resolved_by]).filter((x): x is string => !!x))];
  const sessionIds = [...new Set(rows.map((r) => r.session_id).filter((x): x is string => !!x))];
  const [{ data: people }, { data: sessions }] = await Promise.all([
    supabase.from("staff").select("id, name").in("id", staffIds),
    sessionIds.length ? supabase.from("sessions").select("*").in("id", sessionIds) : Promise.resolve({ data: [] as SessionRow[] }),
  ]);
  const names = new Map(((people as { id: string; name: string }[]) ?? []).map((p) => [p.id, p.name]));
  const titles = new Map(((sessions as SessionRow[]) ?? []).map((s) => [s.id, admin ? adminEventTitle(eventData(s)) : eventTitle(eventData(s))]));
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    eventTitle: r.session_id ? (titles.get(r.session_id) ?? "Event") : "",
    eventHref: r.session_id ? (admin ? `/team/admin/e/${r.session_id}?tab=dayof` : `/team/e/${r.session_id}`) : null,
    staffId: r.staff_id,
    staffName: admin ? (names.get(r.staff_id) ?? "Someone") : firstName(names.get(r.staff_id)) || "You",
    item: r.item,
    level: r.level,
    note: r.note ?? "",
    kind: r.kind,
    status: r.status,
    takenBy: r.taken_by ? firstName(names.get(r.taken_by)) || "Someone" : "",
    takenAt: r.taken_at,
    resolvedBy: r.resolved_by ? firstName(names.get(r.resolved_by)) || "Someone" : "",
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  }));
}

/**
 * The reports this viewer may see, newest first. Staff: only their own.
 * Admins and managers: everyone's. open: only reports not resolved.
 */
export async function listReports(viewer: StaffMember, opts: { open?: boolean; sessionId?: string; limit?: number } = {}): Promise<LowStockView[]> {
  const admin = isAdminRole(viewer.role);
  let q = supabase.from(TABLE).select("*");
  if (!admin) q = q.eq("staff_id", viewer.id);
  if (opts.open) q = q.neq("status", "resolved");
  if (opts.sessionId) q = q.eq("session_id", opts.sessionId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(opts.limit ?? 100);
  if (error) return []; // before the table exists
  return toViews((data as LowStockRow[]) ?? [], admin);
}

/** Open reports, not resolved, for the header count. Admins and managers only. */
export async function openReportCount(viewer: StaffMember): Promise<number> {
  if (!isAdminRole(viewer.role)) return 0;
  const { count, error } = await supabase.from(TABLE).select("id", { count: "exact", head: true }).eq("status", "open");
  return error ? 0 : (count ?? 0);
}

export type ActionResult = { ok: true; report: LowStockView } | { ok: false; error: string; status: number };

async function readReport(id: string): Promise<LowStockRow | null> {
  const { data } = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle();
  return (data as LowStockRow | null) ?? null;
}

async function viewOf(id: string): Promise<LowStockView | null> {
  const row = await readReport(id);
  return row ? (await toViews([row], true))[0] : null;
}

/**
 * "On it": the first admin or manager to tap takes it. The update only
 * matches an open report, so two people tapping at once cannot both take it.
 * Texts the person who reported it "[Name] is on it."
 */
export async function takeReport(viewer: StaffMember, id: string, now: Date = new Date()): Promise<ActionResult> {
  if (!isAdminRole(viewer.role)) return { ok: false, error: "Only admins and managers can do that.", status: 403 };
  const { data, error } = await supabase
    .from(TABLE)
    .update({ status: "on_it", taken_by: viewer.id, taken_at: now.toISOString() })
    .eq("id", id)
    .eq("status", "open")
    .select("*");
  if (error) throw new Error(`${TABLE} take failed: ${error.message}`);
  const taken = ((data as LowStockRow[]) ?? [])[0];
  if (!taken) {
    const current = await viewOf(id);
    if (!current) return { ok: false, error: "That report is gone.", status: 404 };
    if (current.status === "on_it") return { ok: false, error: `${current.takenBy} already has it.`, status: 409 };
    return { ok: false, error: "That report is already resolved.", status: 409 };
  }
  if (taken.staff_id !== viewer.id) {
    const { data: reporter } = await supabase.from("staff").select("id, name, phone, active").eq("id", taken.staff_id).maybeSingle();
    const r = reporter as { name: string; phone: string; active: boolean } | null;
    if (r?.phone && r.active !== false) await sendStaffText(r.phone, r.name, onItText({ name: firstName(viewer.name) || "Someone", item: taken.item, level: taken.level }));
  }
  return { ok: true, report: (await viewOf(id))! };
}

/** "Resolved": closes the report, open or taken, and records who and when. */
export async function resolveReport(viewer: StaffMember, id: string, now: Date = new Date()): Promise<ActionResult> {
  if (!isAdminRole(viewer.role)) return { ok: false, error: "Only admins and managers can do that.", status: 403 };
  const { data, error } = await supabase
    .from(TABLE)
    .update({ status: "resolved", resolved_by: viewer.id, resolved_at: now.toISOString() })
    .eq("id", id)
    .in("status", ["open", "on_it"])
    .select("*");
  if (error) throw new Error(`${TABLE} resolve failed: ${error.message}`);
  if (!((data as LowStockRow[]) ?? [])[0]) {
    const current = await viewOf(id);
    return current ? { ok: false, error: "That report is already resolved.", status: 409 } : { ok: false, error: "That report is gone.", status: 404 };
  }
  return { ok: true, report: (await viewOf(id))! };
}

/**
 * Cron, every 5 minutes. During the 9 AM hour in Chicago, once a day: one
 * text to admins and managers listing every open kit report. Nothing when
 * there are none. Returns texts sent.
 */
export async function sendKitSummary(now: Date = new Date()): Promise<number> {
  if (!summaryDue(now)) return 0;
  const { data, error } = await supabase.from(TABLE).select("*").eq("kind", "kit").neq("status", "resolved").order("created_at", { ascending: true });
  if (error) return 0; // before the table exists; the next run tries again
  const rows = (data as LowStockRow[]) ?? [];
  // Claimed either way, so a report made at 9:20 waits for tomorrow's summary.
  if (!(await claimNotice(summaryKey(now), "low_stock_kit"))) return 0;
  if (rows.length === 0) return 0;
  const views = await toViews(rows, true);
  const message = kitSummaryText({
    reports: views.map((v) => ({ who: v.staffName, item: v.item, level: v.level, note: v.note, takenBy: v.takenBy })),
    link: `${siteOrigin()}/team/admin/running-low`,
  });
  return textAdmins(message);
}
