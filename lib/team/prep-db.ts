// Database side of 1 Tools, 2 Supplies. Server only. Rules in lib/team/prep.ts.
//
// Tools done: the existing "I have everything" confirmation (staff_confirmations),
// counted only while every Tools box is still checked.
// Supplies done: a row in staff_supplies_confirmations, its own table so that
// unchecking a Tools item (which deletes the staff_confirmations row) never
// wipes it. Items left unchecked at the Supplies confirm are reported missing
// like "Something is missing".

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { checklistState, checkRows, getConfirmation, alertAdmins, suppliesConfirmation } from "@/lib/team/events";
import { activeConfirmation } from "@/lib/team/checks";
import { allSupplies, supplyState } from "@/lib/team/supplies";
import { staffSupplies } from "@/lib/team/supplies-db";
import { reportMissing } from "@/lib/team/missing-db";
import { claimNotice, siteOrigin } from "@/lib/team/clock-db";
import { hiddenEventIds } from "@/lib/team/hidden";
import { eventData } from "@/lib/team/markets";
import { adminEventTitle, eventTitle } from "@/lib/team/event-list";
import { sendStaffText } from "@/lib/team/sms";
import { roleSuffix } from "@/lib/team/roles";
import { adminAlertDue, adminAlertText, noticeKeys, staffReminderDue, staffReminderText, startLabel, stepsLeft, type PrepStatus } from "@/lib/team/prep";

export interface PrepTimes {
  toolsAt: string | null;
  suppliesAt: string | null;
}

export const statusOf = (t: PrepTimes): PrepStatus => ({ tools: !!t.toolsAt, supplies: !!t.suppliesAt });


/** When this person finished each step, or null. */
export async function prepTimes(session: SessionRow, staffId: string): Promise<PrepTimes> {
  const ed = session.event_data ?? {};
  const [rows, confirmedAt, suppliesAt] = await Promise.all([checkRows(staffId, session.id, "checklist"), getConfirmation(staffId, session.id), suppliesConfirmation(staffId, session.id)]);
  return { toolsAt: activeConfirmation(confirmedAt, checklistState(ed.package ?? session.package_type, rows)), suppliesAt };
}

export type ConfirmSuppliesResult = { ok: true; confirmedAt: string; missing: string[] } | { ok: false; error: string; status: number };

/**
 * "I have gone through the supplies list". Only once Tools is done. Anything
 * still unchecked is reported missing to admins and managers. Saved once:
 * a second tap keeps the first time and reports nothing again.
 */
export async function confirmSupplies(session: SessionRow, staff: StaffMember, origin: string, now: Date = new Date()): Promise<ConfirmSuppliesResult> {
  const t = await prepTimes(session, staff.id);
  if (!t.toolsAt) return { ok: false, error: "Finish Tools first.", status: 409 };
  if (t.suppliesAt) return { ok: true, confirmedAt: t.suppliesAt, missing: [] };
  const [{ list }, rows] = await Promise.all([staffSupplies(session), checkRows(staff.id, session.id, "shopping")]);
  const state = supplyState(list, rows);
  const unchecked = allSupplies(list).filter((i) => !state[i.key]?.checked);
  const confirmedAt = now.toISOString();
  const { error } = await supabase.from("staff_supplies_confirmations").insert({ staff_id: staff.id, session_id: session.id, confirmed_at: confirmedAt, missing_count: unchecked.length });
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) return { ok: true, confirmedAt: (await suppliesConfirmation(staff.id, session.id)) ?? confirmedAt, missing: [] };
    throw new Error(`staff_supplies_confirmations save failed: ${error.message}`);
  }
  if (unchecked.length) await reportMissing(session, staff, unchecked, "Not checked off when they went through the supplies list.", `${origin.replace(/\/+$/, "")}/team/e/${session.id}`);
  return { ok: true, confirmedAt, missing: unchecked.map((i) => i.item) };
}

/** Each person's two steps, for the manager's Day of tab. */
export async function prepFor(session: SessionRow, staffIds: string[]): Promise<Map<string, PrepTimes>> {
  const out = new Map<string, PrepTimes>();
  await Promise.all(staffIds.map(async (id) => out.set(id, await prepTimes(session, id))));
  return out;
}

/**
 * Cron. 2 hours before service: one text to each person on the event (accepted)
 * with a step left. 30 minutes before: one text to admins and managers with
 * alerts on, naming who has not finished which step. Neither blocks clock in.
 */
export async function sendPrepReminders(now: Date = new Date()): Promise<number> {
  const { data: rows, error } = await supabase.from("event_assignments").select("id, session_id, staff_id, status").eq("status", "accepted");
  if (error || !rows) return 0;
  const bySession = new Map<string, { id: string; staff_id: string }[]>();
  for (const r of rows as { id: string; session_id: string; staff_id: string }[]) bySession.set(r.session_id, [...(bySession.get(r.session_id) ?? []), r]);
  if (bySession.size === 0) return 0;
  const hidden = await hiddenEventIds();
  const { data: sessions } = await supabase.from("sessions").select("*").in("id", [...bySession.keys()]).eq("status", "submitted");
  let sent = 0;
  for (const s of (sessions as SessionRow[]) ?? []) {
    if (hidden.has(s.id)) continue;
    const ed = eventData(s);
    // Cheap window check before reading anyone's lists.
    if (!staffReminderDue(ed, now, { tools: false, supplies: false })) continue;
    const mine = bySession.get(s.id) ?? [];
    const { data: staffRows } = await supabase.from("staff").select("id, name, phone, role, active").in("id", mine.map((m) => m.staff_id));
    const staff = new Map(((staffRows as { id: string; name: string; phone: string; role: string; active: boolean }[]) ?? []).filter((x) => x.active).map((x) => [x.id, x]));
    const people: { name: string; status: PrepStatus; assignmentId: string; phone: string; fullName: string }[] = [];
    for (const m of mine) {
      const st = staff.get(m.staff_id);
      if (!st) continue;
      people.push({ name: `${st.name}${roleSuffix(st.role)}`, status: statusOf(await prepTimes(s, st.id)), assignmentId: m.id, phone: st.phone, fullName: st.name });
    }
    const link = `${siteOrigin()}/team/e/${s.id}`;
    for (const p of people) {
      if (!staffReminderDue(ed, now, p.status)) continue;
      if (!(await claimNotice(noticeKeys.staff(p.assignmentId), "prep_staff"))) continue;
      const ok = await sendStaffText(p.phone, p.fullName, staffReminderText({ firstName: firstName(p.fullName), title: eventTitle(ed), startTime: startLabel(ed), left: stepsLeft(p.status), link }));
      if (ok) sent++;
    }
    if (adminAlertDue(ed, now, people.map((p) => p.status)) && (await claimNotice(noticeKeys.admin(s.id), "prep_admin"))) {
      const message = adminAlertText({
        title: adminEventTitle(ed),
        startTime: startLabel(ed),
        people: people.filter((p) => stepsLeft(p.status)).map((p) => ({ name: p.name, left: stepsLeft(p.status) })),
        link: `${siteOrigin()}/team/admin/e/${s.id}?tab=dayof`,
      });
      const admins = await alertAdmins();
      const results = await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
      if (results.some(Boolean)) sent++;
    }
  }
  return sent;
}
