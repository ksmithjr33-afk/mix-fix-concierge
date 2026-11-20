// Resend invite, database side: last sign ins for the Staff page, the send,
// the two minute limit, and the log in staff_invites. Server only. The text
// and the rules are in lib/team/invites.ts.
//
// Last sign in needs no new column: every sign in uses a text code, and the
// codes are kept, so the newest used code for a phone number is that person's
// last sign in.

import { supabase } from "@/lib/supabase";
import { sendStaffText } from "@/lib/team/sms";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { chicagoStamp } from "@/lib/team/time";
import { INVITE_GAP_MS, inviteWaitMs, lastFour, sentLine, signInLine, welcomeText, type InviteStatus } from "@/lib/team/invites";


/** Last sign in and last invite for each person, in two queries for the whole list. */
export async function inviteStatuses(staff: { id: string; phone: string }[]): Promise<Record<string, InviteStatus>> {
  const out: Record<string, InviteStatus> = {};
  if (staff.length === 0) return out;
  const phones = [...new Set(staff.map((s) => s.phone).filter(Boolean))];
  const [codes, invites] = await Promise.all([
    supabase.from("staff_login_codes").select("phone, used_at").in("phone", phones),
    supabase.from("staff_invites").select("staff_id, ok, created_at, sender:sent_by (name)").in("staff_id", staff.map((s) => s.id)).eq("ok", true).order("created_at", { ascending: false }),
  ]);
  const signedIn = new Map<string, string>();
  for (const c of (codes.data as { phone: string; used_at: string | null }[] | null) ?? []) {
    if (c.used_at && (!signedIn.has(c.phone) || c.used_at > signedIn.get(c.phone)!)) signedIn.set(c.phone, c.used_at);
  }
  // Before the migration staff_invites does not exist: no last invite, nothing else changes.
  const lastInvite = new Map<string, string>();
  for (const r of (invites.data as { staff_id: string; created_at: string; sender: unknown }[] | null) ?? []) {
    if (lastInvite.has(r.staff_id)) continue;
    const by = firstName(((Array.isArray(r.sender) ? r.sender[0] : r.sender) as { name?: string } | null)?.name ?? "");
    lastInvite.set(r.staff_id, `Last invite ${chicagoStamp(r.created_at)}${by ? ` by ${by}` : ""}`);
  }
  for (const s of staff) out[s.id] = { signIn: signInLine(chicagoStamp(signedIn.get(s.phone))), lastInvite: lastInvite.get(s.id) ?? "" };
  return out;
}

export type InviteResult = { ok: true; line: string; sentAt: string } | { ok: false; error: string; status: number };

/**
 * Send the welcome text to an active staff member now, never held for quiet
 * hours, and log who sent it. One per person every two minutes: a text that
 * went out, or one being sent, holds the slot; a failed one does not.
 */
export async function resendInvite(actor: Pick<StaffMember, "id">, staffId: string, origin: string, now: Date = new Date()): Promise<InviteResult> {
  const { data: person } = await supabase.from("staff").select("id, name, phone, active").eq("id", staffId).maybeSingle();
  const p = person as { id: string; name: string; phone: string; active: boolean } | null;
  if (!p) return { ok: false, error: "That person is not on the team.", status: 404 };
  if (!p.active) return { ok: false, error: "Reactivate them first, then send the invite.", status: 400 };

  const since = new Date(now.getTime() - INVITE_GAP_MS).toISOString();
  const { data: recent, error: readErr } = await supabase
    .from("staff_invites")
    .select("ok, created_at")
    .eq("staff_id", p.id)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (readErr) return { ok: false, error: "Could not send the invite. Try again.", status: 500 };
  const holding = ((recent as { ok: boolean | null; created_at: string }[] | null) ?? []).find((r) => r.ok !== false);
  if (holding) {
    const secs = Math.ceil(inviteWaitMs(holding.created_at, now) / 1000);
    return { ok: false, error: `An invite just went to ${firstName(p.name) || "them"}. You can send another in ${secs} second${secs === 1 ? "" : "s"}.`, status: 429 };
  }

  // The log row first: it holds the slot while the text goes out.
  const { data: row, error: logErr } = await supabase
    .from("staff_invites")
    .insert({ staff_id: p.id, sent_by: actor.id, phone: p.phone, ok: null, created_at: now.toISOString() })
    .select("id")
    .single();
  if (logErr || !row) return { ok: false, error: "Could not send the invite. Try again.", status: 500 };

  const sent = await sendStaffText(p.phone, p.name, welcomeText({ firstName: firstName(p.name), link: `${origin}/team` }));
  await supabase.from("staff_invites").update({ ok: sent }).eq("id", (row as { id: string }).id);
  if (!sent) return { ok: false, error: `The text did not go out to ••• ${lastFour(p.phone)}. Check the number and try again.`, status: 502 };
  return { ok: true, line: sentLine(p.phone, chicagoStamp(now.toISOString())), sentAt: now.toISOString() };
}
