// Database side of announcements. Server only.
//
// Sending writes one recipient row per person (unique per announcement), so
// nobody can get two texts for one announcement. Texts due now go out at
// once; texts held for quiet hours go from the cron at 8:00 AM in each
// person's time zone. Every text goes through sendStaffText, and a failed
// text never fails the send.

import { supabase } from "@/lib/supabase";
import type { StaffMember } from "@/lib/team/event-view";
import { sendStaffText } from "@/lib/team/sms";
import { siteOrigin } from "@/lib/team/clock-db";
import { inQuietHours } from "@/lib/team/shifts";
import { announcementSendAfter, announcementText, audienceOf, recipientTz, validateAnnouncement, type StaffLike } from "@/lib/team/announcements";

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  markets: string[];
  bartenders_only: boolean;
  send_now: boolean;
  created_by: string | null;
  created_at: string;
}

interface RecipientRow {
  id: string;
  announcement_id: string;
  staff_id: string;
  time_zone: string;
  send_after: string;
  status: string;
  sent_at: string | null;
  opened_at: string | null;
}

type StaffFull = StaffLike & { name: string; phone: string };

type Result<T> = ({ ok: true } & T) | { ok: false; error: string; status: number };

export function announcementLink(id: string): string {
  return `${siteOrigin()}/team/announcements/${encodeURIComponent(id)}`;
}

/** Save an announcement, queue one text per person, and send the ones due now. */
export async function createAnnouncement(
  admin: StaffMember,
  raw: Record<string, unknown>,
  now: Date = new Date()
): Promise<Result<{ id: string; recipients: number; texted: number; held: number }>> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const v = validateAnnouncement(raw);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const a = v.value;
  const { data: staffRows } = await supabase.from("staff").select("*").eq("active", true);
  const people = audienceOf((staffRows as StaffFull[]) ?? [], a, admin.id);
  if (people.length === 0) return { ok: false, error: "Nobody matches that audience.", status: 400 };
  const { data, error } = await supabase
    .from("announcements")
    .insert({ title: a.title, body: a.body, markets: a.markets, bartenders_only: a.bartendersOnly, send_now: a.sendNow, created_by: admin.id, created_at: now.toISOString() })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: "Could not save. Try again.", status: 500 };
  const row = data as AnnouncementRow;
  const { error: rErr } = await supabase.from("announcement_recipients").upsert(
    people.map((p) => {
      const tz = recipientTz(p, a.markets);
      return { announcement_id: row.id, staff_id: p.id, time_zone: tz, send_after: announcementSendAfter(now, tz, a.sendNow).toISOString(), status: "pending" };
    }),
    { onConflict: "announcement_id,staff_id", ignoreDuplicates: true }
  );
  if (rErr) {
    console.error("[team] saving announcement recipients failed:", rErr.message);
    return { ok: false, error: "Could not save the recipients. Try again.", status: 500 };
  }
  const texted = await deliverAnnouncements(now, row.id);
  const { data: waiting } = await supabase.from("announcement_recipients").select("id").eq("announcement_id", row.id).eq("status", "pending");
  return { ok: true, id: row.id, recipients: people.length, texted, held: ((waiting as unknown[]) ?? []).length };
}

/** Send announcement texts that are due. Each row is claimed first, so nobody is texted twice. Returns texts sent. */
export async function deliverAnnouncements(now: Date = new Date(), announcementId?: string): Promise<number> {
  let q = supabase.from("announcement_recipients").select("*").eq("status", "pending");
  if (announcementId) q = q.eq("announcement_id", announcementId);
  const { data, error } = await q;
  if (error || !data) return 0;
  const due = (data as RecipientRow[]).filter((r) => new Date(r.send_after).getTime() <= now.getTime());
  if (due.length === 0) return 0;
  const ids = [...new Set(due.map((r) => r.announcement_id))];
  const { data: aRows } = await supabase.from("announcements").select("*").in("id", ids);
  const byId = new Map(((aRows as AnnouncementRow[]) ?? []).map((a) => [a.id, a]));
  const { data: sRows } = await supabase.from("staff").select("*").in("id", [...new Set(due.map((r) => r.staff_id))]);
  const staff = new Map(((sRows as StaffFull[]) ?? []).map((s) => [s.id, s]));
  let sent = 0;
  for (const r of due) {
    const a = byId.get(r.announcement_id);
    // A held text that comes due while it is quiet again (a late cron run) waits for the morning.
    if (!a || (!a.send_now && inQuietHours(now, r.time_zone))) continue;
    const { data: claimed } = await supabase.from("announcement_recipients").update({ status: "sending" }).eq("id", r.id).eq("status", "pending").select("id");
    if (((claimed as unknown[]) ?? []).length === 0) continue;
    const s = staff.get(r.staff_id);
    if (!s || !s.active) {
      await supabase.from("announcement_recipients").update({ status: "skipped" }).eq("id", r.id);
      continue;
    }
    const ok = await sendStaffText(s.phone, s.name, announcementText({ title: a.title, link: announcementLink(a.id) }));
    await supabase.from("announcement_recipients").update({ status: ok ? "sent" : "failed", sent_at: now.toISOString() }).eq("id", r.id);
    if (ok) sent++;
  }
  return sent;
}

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  unread: boolean;
  audience: { markets: string[]; bartenders_only: boolean };
  opened?: number; // admins: how many recipients opened it
  recipients?: number;
}

/** Announcements this person can read, newest first: every one for admins, their own for everyone else. */
export async function announcementsFor(staff: StaffMember): Promise<AnnouncementItem[]> {
  const { data: mine, error } = await supabase.from("announcement_recipients").select("*").eq("staff_id", staff.id);
  if (error) return []; // before the tables exist
  const myRows = new Map(((mine as RecipientRow[]) ?? []).map((r) => [r.announcement_id, r]));
  let rows: AnnouncementRow[];
  if (staff.role === "admin") {
    const { data } = await supabase.from("announcements").select("*").order("created_at", { ascending: false });
    rows = (data as AnnouncementRow[]) ?? [];
  } else {
    if (myRows.size === 0) return [];
    const { data } = await supabase.from("announcements").select("*").in("id", [...myRows.keys()]).order("created_at", { ascending: false });
    rows = (data as AnnouncementRow[]) ?? [];
  }
  let stats = new Map<string, { opened: number; total: number }>();
  if (staff.role === "admin" && rows.length) {
    const { data } = await supabase.from("announcement_recipients").select("announcement_id, opened_at").in("announcement_id", rows.map((r) => r.id));
    stats = new Map();
    for (const r of (data as Pick<RecipientRow, "announcement_id" | "opened_at">[]) ?? []) {
      const s = stats.get(r.announcement_id) ?? { opened: 0, total: 0 };
      s.total++;
      if (r.opened_at) s.opened++;
      stats.set(r.announcement_id, s);
    }
  }
  return rows
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      createdAt: a.created_at,
      unread: !!myRows.get(a.id) && !myRows.get(a.id)!.opened_at,
      audience: { markets: a.markets ?? [], bartenders_only: a.bartenders_only },
      ...(staff.role === "admin" ? { opened: stats.get(a.id)?.opened ?? 0, recipients: stats.get(a.id)?.total ?? 0 } : {}),
    }));
}

export interface AnnouncementDetail {
  item: AnnouncementItem;
  // Admins only: who has opened it and who has not.
  opens: { name: string; openedAt: string | null; text: string }[] | null;
}

/** Open one announcement. Marks it opened for a recipient. Null when this person cannot read it. */
export async function openAnnouncement(id: string, staff: StaffMember, now: Date = new Date()): Promise<AnnouncementDetail | null> {
  const { data: a, error } = await supabase.from("announcements").select("*").eq("id", id).maybeSingle();
  if (error || !a) return null;
  const row = a as AnnouncementRow;
  const { data: mine } = await supabase.from("announcement_recipients").select("*").eq("announcement_id", id).eq("staff_id", staff.id).maybeSingle();
  const me = (mine as RecipientRow | null) ?? null;
  if (!me && staff.role !== "admin") return null;
  if (me && !me.opened_at) {
    await supabase.from("announcement_recipients").update({ opened_at: now.toISOString() }).eq("id", me.id).is("opened_at", null);
  }
  let opens: AnnouncementDetail["opens"] = null;
  if (staff.role === "admin") {
    const { data: rs } = await supabase.from("announcement_recipients").select("*").eq("announcement_id", id);
    const recips = (rs as RecipientRow[]) ?? [];
    const { data: ss } = recips.length ? await supabase.from("staff").select("id, name").in("id", recips.map((r) => r.staff_id)) : { data: [] };
    const names = new Map(((ss as { id: string; name: string }[]) ?? []).map((s) => [s.id, s.name]));
    opens = recips
      .map((r) => ({
        name: names.get(r.staff_id) ?? "Former staff",
        openedAt: r.staff_id === staff.id && !r.opened_at ? now.toISOString() : r.opened_at,
        text: r.status === "pending" ? "text held for quiet hours" : r.status === "failed" ? "text failed" : r.status === "skipped" ? "not texted" : "texted",
      }))
      .sort((x, y) => Number(!!y.openedAt) - Number(!!x.openedAt) || x.name.localeCompare(y.name));
  }
  return {
    item: {
      id: row.id,
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
      unread: false,
      audience: { markets: row.markets ?? [], bartenders_only: row.bartenders_only },
    },
    opens,
  };
}

/** How many announcements this person has not opened yet. Zero before the tables exist. */
export async function unreadAnnouncements(staffId: string): Promise<number> {
  const { data, error } = await supabase.from("announcement_recipients").select("id, opened_at").eq("staff_id", staffId).is("opened_at", null);
  if (error || !data) return 0;
  return (data as unknown[]).length;
}
