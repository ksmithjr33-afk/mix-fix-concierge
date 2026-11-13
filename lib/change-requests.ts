// Client change requests inside six days of the event: a drink change, or (auto
// send on) a change to the client's shopping list, saved as a hold for an admin
// to Approve or Decline instead of being refused. This file tells people about
// a new request: GHL gets change_request_pending in the update payload, and
// the admins get one text through the staff text webhook. Inside quiet hours
// (9 PM to 8 AM in the event's time zone) the text waits for 8 AM, unless the
// event starts within 24 hours. Server only.

import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/event-updates";
import { getHold, type HoldRow } from "@/lib/client-list-db";
import { changeRequestFields } from "@/lib/client-list";
import { postListOnly } from "@/lib/update-delivery";
import { recapLines, type FieldChange } from "@/lib/event-diff";
import { alertAdmins } from "@/lib/team/events";
import { sendStaffText } from "@/lib/team/sms";
import { inQuietHours, sendableAt } from "@/lib/team/shifts";
import { eventDayStart, eventSchedule, shortDate } from "@/lib/team/time";
import { eventData } from "@/lib/team/markets";
import { eventTitle } from "@/lib/team/event-list";
import { siteOrigin } from "@/lib/team/clock-db";
import { managerHref } from "@/lib/team/manager-tabs";

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the client asked for, in plain words with drink names only: "Drink 1: from Mule to Paloma; Guest count: from 100 to 150". */
export function requestSummary(changes: FieldChange[] | null | undefined): string {
  return recapLines(changes ?? []).join("; ");
}

/**
 * When the admin text may go: right away, or at 8:00 AM in the event's time
 * zone when it is quiet hours. An event that starts within 24 hours never waits.
 */
export function requestTextAt(ed: Record<string, unknown>, now: Date): { now: boolean; at: Date } {
  const s = eventSchedule(ed);
  if (!inQuietHours(now, s.tz)) return { now: true, at: now };
  const start = s.start ?? eventDayStart(ed);
  if (start && start.getTime() - now.getTime() <= DAY_MS) return { now: true, at: now };
  return { now: false, at: sendableAt(now, s.tz) };
}

/** The admin text: the event name, date, what was asked, and the link to Approve or Decline. */
export function requestText(o: { title: string; date: string; asked: string; link: string }): string {
  const asked = o.asked.length > 300 ? `${o.asked.slice(0, 297).trimEnd()}...` : o.asked;
  return `Change request for ${o.title} on ${o.date}: ${asked || "see the request"}. It is not saved until you approve it. Approve or decline: ${o.link}`;
}

async function textAdmins(hold: HoldRow, now: Date): Promise<number> {
  // Claimed first, so a request is texted once even if two runs overlap.
  const { data: claimed, error } = await supabase
    .from("client_list_holds")
    .update({ admin_texted_at: now.toISOString() })
    .eq("id", hold.id)
    .eq("status", "pending")
    .is("admin_texted_at", null)
    .select("id");
  if (error || ((claimed as unknown[]) ?? []).length === 0) return 0;
  const session = await getSession(hold.session_id);
  if (!session) return 0;
  const ed = eventData(session);
  const message = requestText({
    title: eventTitle(ed),
    date: shortDate(eventSchedule(ed).day),
    asked: requestSummary(hold.changes),
    link: `${siteOrigin()}${managerHref(hold.session_id, "client")}`,
  });
  const admins = await alertAdmins();
  const sent = await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
  return sent.filter(Boolean).length;
}

/**
 * A new request came in: tell GHL (change_request_pending true) and text the
 * admins now, or set the text for 8:00 AM when it is quiet hours. Never
 * throws, so it never blocks the client's chat.
 */
export async function announceRequest(holdId: string, now: Date = new Date()): Promise<void> {
  try {
    const hold = await getHold(holdId);
    if (!hold || hold.status !== "pending" || hold.kind !== "change") return;
    const session = await getSession(hold.session_id);
    if (!session) return;
    const error = await postListOnly(session, changeRequestFields({ pending: true, summary: requestSummary(hold.changes) }));
    if (error) console.error(`[change-request] session ${session.id} GHL payload:`, error);
    if (hold.admin_texted_at || hold.admin_text_after) return;
    const when = requestTextAt(eventData(session), now);
    if (when.now) {
      await textAdmins(hold, now);
    } else {
      const { error: saveError } = await supabase.from("client_list_holds").update({ admin_text_after: when.at.toISOString() }).eq("id", hold.id);
      if (saveError) console.error(`[change-request] hold ${hold.id} could not set the 8 AM text:`, saveError.message);
    }
  } catch (err) {
    console.error(`[change-request] hold ${holdId} announce failed:`, err instanceof Error ? err.message : String(err));
  }
}

/** Cron, every 5 minutes: the admin texts for requests that came in during quiet hours, at 8:00 AM. Returns texts sent. */
export async function sendRequestTexts(now: Date = new Date()): Promise<number> {
  const { data, error } = await supabase.from("client_list_holds").select("*").eq("status", "pending").eq("kind", "change").is("admin_texted_at", null);
  if (error || !data) return 0; // before the columns exist
  let sent = 0;
  for (const hold of data as HoldRow[]) {
    if (!hold.admin_text_after || new Date(hold.admin_text_after).getTime() > now.getTime()) continue;
    const session = await getSession(hold.session_id);
    // A late cron run that lands in quiet hours again waits, unless the event is within 24 hours.
    if (!session || !requestTextAt(eventData(session), now).now) continue;
    sent += await textAdmins(hold, now);
  }
  return sent;
}
