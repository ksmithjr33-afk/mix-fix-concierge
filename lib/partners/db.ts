// Database side of the partner portal: partner accounts, planners on events,
// the booking holder and host, the pricing switches, and the activity log.
// Server only. Every read here tolerates the tables not existing yet (before
// supabase/migrations/20261225_partners.sql runs), so every existing page keeps
// loading and every existing event reads as client held with no planners.

import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { getSession } from "@/lib/event-updates";
import { hashToken, normalizePhone } from "@/lib/team/codes";
import { siteOrigin } from "@/lib/team/clock-db";
import { alertAdmins } from "@/lib/team/events";
import { sendStaffText } from "@/lib/team/sms";
import { eventData, eventTimeZone, isMarket } from "@/lib/team/markets";
import { adminEventTitle } from "@/lib/team/event-list";
import { eventSchedule, shortDate } from "@/lib/team/time";
import { managerHref } from "@/lib/team/manager-tabs";
import { PARTNER_COLUMNS, endAllPartnerSessions, findPartnerByPhone, type Principal } from "@/lib/partners/auth";
import { sendPartnerText } from "@/lib/partners/texts";
import {
  bookingOf,
  cleanEmail,
  cleanField,
  cleanWebsite,
  clientPlannerAddedText,
  deactivatedAdminText,
  eventForName,
  hostWelcomeText,
  leadRemovedAdminText,
  plannerWelcomeText,
  type Booking,
  type BookingColumns,
  type BookingHolder,
  type EventViewer,
  type LinkedVia,
  type Partner,
  type PlannerLink,
  type PricingSwitch,
} from "@/lib/partners/rules";
import {
  HOST_SURPRISE_REFUSAL,
  PLANNER_SURPRISE_REFUSAL,
  honoreeRefusal,
  isHonoree,
  surpriseActive,
  surpriseOf,
} from "@/lib/partners/surprise";

export type EventSession = SessionRow & BookingColumns & { phone?: string | null; team_market?: string | null };

/** Who did something: a planner, a host, the client, staff, or the system. */
export interface Actor {
  kind: "planner" | "host" | "client" | "staff" | "system";
  name: string;
  partnerId?: string | null;
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };
const fail = (error: string, status = 400) => ({ ok: false as const, error, status });

const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export const signInLink = () => `${siteOrigin()}/partners`;
export const partnerEventHref = (key: string) => `/partners/e/${encodeURIComponent(key)}`;
export const clientEventLink = (sessionId: string) => `${siteOrigin()}/s?id=${encodeURIComponent(sessionId)}`;

/** The client's (booking contact's) phone: what the booking or the concierge gave. */
export function clientPhone(s: EventSession): string {
  const ed = s.event_data ?? {};
  return normalizePhone(ed.client_phone) ?? normalizePhone(s.phone) ?? "";
}

/** True while this event's guest of honor must not be contacted (see lib/partners/surprise.ts). */
export const surpriseOn = (s: EventSession, now: Date = new Date()) => surpriseActive(s, now, eventTimeZone(s));

/**
 * Who may never be added as a planner on a surprise event: the guest of honor
 * (by phone or email) and the host (the person the event is for). Null when
 * this person may be added. Checked before an account is matched or made.
 */
export function plannerRefusal(s: EventSession, input: { phone?: unknown; email?: unknown }, now: Date = new Date()): string | null {
  if (!surpriseOn(s, now)) return null;
  if (isHonoree(s, input)) return honoreeRefusal("planner");
  const phone = normalizePhone(input.phone);
  if (phone && s.host_phone && normalizePhone(s.host_phone) === phone) return PLANNER_SURPRISE_REFUSAL;
  return null;
}

// ----- Partners -----

export async function getPartner(id: string): Promise<(Partner & { internal_notes: string }) | null> {
  const { data, error } = await supabase.from("partners").select("*").eq("id", id).maybeSingle();
  if (error) return null;
  return (data as (Partner & { internal_notes: string }) | null) ?? null;
}

export async function partnersByIds(ids: string[]): Promise<Map<string, Partner>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("partners").select(PARTNER_COLUMNS).in("id", ids);
  if (error || !data) return new Map();
  return new Map((data as Partner[]).map((p) => [p.id, p]));
}

export interface PartnerInput {
  name?: unknown;
  company?: unknown;
  phone?: unknown;
  email?: unknown;
  website?: unknown;
  markets?: unknown;
  internal_notes?: unknown;
}

function cleanMarkets(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter(isMarket))] : [];
}

/**
 * Match a planner by phone, or create one as active. A match keeps its own
 * details, filling only the blanks. A deactivated match is refused: turning a
 * partner back on is an admin's call.
 */
export async function findOrCreatePlanner(input: PartnerInput, createdBy: string): Promise<Result<{ partner: Partner; created: boolean }>> {
  const phone = normalizePhone(input.phone);
  if (!phone) return fail("Enter the planner's phone number.");
  const existing = await findPartnerByPhone(phone);
  if (existing) {
    if (!existing.active) return fail("That planner's account is turned off. An admin can turn it back on from Partners.", 409);
    const fill: Record<string, unknown> = {};
    const name = cleanField(input.name, 80);
    const company = cleanField(input.company, 120);
    const email = cleanEmail(input.email);
    if (!existing.name && name) fill.name = name;
    if (!existing.company && company) fill.company = company;
    if (!existing.email && email) fill.email = email;
    if (Object.keys(fill).length > 0) {
      await supabase.from("partners").update({ ...fill, updated_at: new Date().toISOString() }).eq("id", existing.id);
      Object.assign(existing, fill);
    }
    return { ok: true, partner: existing, created: false };
  }
  const { data, error } = await supabase
    .from("partners")
    .insert({
      type: "planner",
      phone,
      name: cleanField(input.name, 80),
      company: cleanField(input.company, 120),
      email: cleanEmail(input.email),
      website: cleanWebsite(input.website),
      markets: cleanMarkets(input.markets),
      internal_notes: cleanField(input.internal_notes, 4000),
      active: true,
      created_by_name: createdBy,
    })
    .select(PARTNER_COLUMNS)
    .single();
  if (error || !data) {
    // Two links at once for the same new phone: the other one created it.
    const again = await findPartnerByPhone(phone);
    if (again) return { ok: true, partner: again, created: false };
    return fail("Could not save the planner. Try again.", 500);
  }
  return { ok: true, partner: data as Partner, created: true };
}

/** Admins and managers: edit a partner's details. The phone is their login, so a change must not clash. */
export async function updatePartner(id: string, input: PartnerInput): Promise<Result> {
  const p = await getPartner(id);
  if (!p) return fail("We could not find that partner.", 404);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = cleanField(input.name, 80);
  if (input.company !== undefined) patch.company = cleanField(input.company, 120);
  if (input.email !== undefined) patch.email = cleanEmail(input.email);
  if (input.website !== undefined) patch.website = cleanWebsite(input.website);
  if (input.markets !== undefined) patch.markets = cleanMarkets(input.markets);
  if (input.internal_notes !== undefined) patch.internal_notes = cleanField(input.internal_notes, 4000);
  if (input.phone !== undefined) {
    const phone = normalizePhone(input.phone);
    if (!phone) return fail("Enter a phone number.");
    if (phone !== p.phone) {
      const clash = await findPartnerByPhone(phone);
      if (clash) return fail("Another partner already has that phone number.", 409);
      patch.phone = phone;
      await endAllPartnerSessions(id); // the old phone's sessions end with it
    }
  }
  const { error } = await supabase.from("partners").update(patch).eq("id", id);
  if (error) return fail("Could not save. Try again.", 500);
  return { ok: true };
}

/** A partner editing their own profile: name, company, email, website. Never the phone, which is their login. */
export async function updateOwnProfile(partnerId: string, input: PartnerInput): Promise<Result> {
  const name = cleanField(input.name, 80);
  if (!name) return fail("Enter your name.");
  const { error } = await supabase
    .from("partners")
    .update({ name, company: cleanField(input.company, 120), email: cleanEmail(input.email), website: cleanWebsite(input.website), updated_at: new Date().toISOString() })
    .eq("id", partnerId);
  if (error) return fail("Could not save. Try again.", 500);
  await refreshLabels(partnerId);
  return { ok: true };
}

/**
 * Deactivate: ends every session at once (and with it every page and action,
 * which all check active), and alerts the admins about every event the
 * planner holds or leads.
 */
export async function deactivatePartner(id: string, by: Actor): Promise<Result<{ alerted: number }>> {
  const p = await getPartner(id);
  if (!p) return fail("We could not find that partner.", 404);
  const { error } = await supabase.from("partners").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return fail("Could not save. Try again.", 500);
  await endAllPartnerSessions(id);
  const links = await liveLinksForPartner(id);
  const leads = links.filter((l) => l.is_lead);
  const events: { title: string; date: string; role: string }[] = [];
  for (const l of leads) {
    const s = (await getSession(l.session_id)) as EventSession | null;
    if (!s) continue;
    const ed = eventData(s);
    events.push({ title: adminEventTitle(ed), date: shortDate(eventSchedule(ed).day), role: bookingOf(s).holder === "planner" ? "holds the booking" : "Lead" });
    await logActivity(l.session_id, by, "Planner deactivated", `${p.name || p.phone} no longer has access`, id);
  }
  let alerted = 0;
  if (events.length > 0) {
    const message = deactivatedAdminText({ partner: p.name || p.phone, events, link: `${siteOrigin()}/team/admin/partners/${encodeURIComponent(id)}` });
    const admins = await alertAdmins();
    const sent = await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
    alerted = sent.filter(Boolean).length;
  }
  return { ok: true, alerted };
}

export async function reactivatePartner(id: string): Promise<Result> {
  const { error } = await supabase.from("partners").update({ active: true, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? fail("Could not save. Try again.", 500) : { ok: true };
}

// ----- Planners on events -----

async function linksWhere(col: "session_id" | "partner_id", value: string, live: boolean): Promise<PlannerLink[]> {
  let q = supabase.from("event_planners").select("*").eq(col, value);
  if (live) q = q.is("removed_at", null);
  const { data, error } = await q.order("linked_at", { ascending: true });
  if (error || !data) return [];
  return data as PlannerLink[];
}

export const liveLinks = (sessionId: string) => linksWhere("session_id", sessionId, true);
export const allLinks = (sessionId: string) => linksWhere("session_id", sessionId, false);
export const liveLinksForPartner = (partnerId: string) => linksWhere("partner_id", partnerId, true);

export interface PlannerOnEvent {
  linkId: string;
  partner: Partner;
  isLead: boolean;
  linkedVia: LinkedVia;
  linkedBy: string;
  linkedAt: string;
}

export async function plannersOn(sessionId: string): Promise<PlannerOnEvent[]> {
  const links = await liveLinks(sessionId);
  const partners = await partnersByIds(links.map((l) => l.partner_id));
  return links
    .filter((l) => partners.has(l.partner_id))
    .map((l) => ({ linkId: l.id, partner: partners.get(l.partner_id)!, isLead: l.is_lead, linkedVia: l.linked_via, linkedBy: l.linked_by_name, linkedAt: l.linked_at }))
    .sort((a, b) => Number(b.isLead) - Number(a.isLead) || a.linkedAt.localeCompare(b.linkedAt));
}

/** The event's id in partner links. Made once, never the client's link id. */
export async function ensurePartnerKey(s: EventSession): Promise<string | null> {
  if (s.partner_key) return s.partner_key;
  const key = crypto.randomBytes(12).toString("hex");
  const { error } = await supabase.from("sessions").update({ partner_key: key }).eq("id", s.id).is("partner_key", null);
  if (error) return null;
  const fresh = (await getSession(s.id)) as EventSession | null;
  s.partner_key = fresh?.partner_key ?? key;
  return s.partner_key ?? null;
}

/** The Lead's company, or name, for "via" in admin titles. Empty with no Lead. */
async function setPlannerLabel(sessionId: string): Promise<void> {
  const lead = (await plannersOn(sessionId)).find((p) => p.isLead);
  const label = lead ? lead.partner.company || lead.partner.name : null;
  await supabase.from("sessions").update({ planner_label: label || null }).eq("id", sessionId);
}

/** A planner changed their name or company: every event they lead gets the new label. */
async function refreshLabels(partnerId: string): Promise<void> {
  for (const l of (await liveLinksForPartner(partnerId)).filter((x) => x.is_lead)) await setPlannerLabel(l.session_id);
}

export async function logActivity(sessionId: string, actor: Actor, action: string, detail = "", partnerId?: string | null): Promise<void> {
  const { error } = await supabase.from("partner_activity").insert({
    session_id: sessionId,
    partner_id: partnerId ?? actor.partnerId ?? null,
    actor_kind: actor.kind,
    actor_name: actor.name,
    action,
    detail: detail.slice(0, 1000),
  });
  if (error) console.error(`[partners] activity log for ${sessionId} failed:`, error.message);
}

export interface ActivityRow {
  id: string;
  session_id: string;
  partner_id: string | null;
  actor_kind: Actor["kind"];
  actor_name: string;
  action: string;
  detail: string;
  created_at: string;
}

export async function activityFor(sessionId: string): Promise<ActivityRow[]> {
  const { data, error } = await supabase.from("partner_activity").select("*").eq("session_id", sessionId).order("created_at", { ascending: false }).limit(200);
  return error || !data ? [] : (data as ActivityRow[]);
}

export async function activityByPartner(partnerId: string): Promise<ActivityRow[]> {
  const { data, error } = await supabase.from("partner_activity").select("*").eq("partner_id", partnerId).order("created_at", { ascending: false }).limit(200);
  return error || !data ? [] : (data as ActivityRow[]);
}

/**
 * Link a planner to an event (the three ways: they booked it, staff added
 * them, or the client or the Lead added them). An existing live link is kept.
 * Each new link is logged with who and when, and the planner gets a welcome
 * text. Staff linking a planner to a client held event also texts the client
 * a one tap remove link.
 */
export async function linkPlanner(
  s: EventSession,
  partner: Partner,
  opts: { via: LinkedVia; by: Actor; lead?: boolean; now?: Date }
): Promise<Result<{ linkId: string; fresh: boolean }>> {
  if (!partner.active) return fail("That planner's account is turned off.", 409);
  const refused = plannerRefusal(s, partner, opts.now);
  if (refused) return fail(refused, 409);
  const live = await liveLinks(s.id);
  const existing = live.find((l) => l.partner_id === partner.id);
  if (existing) {
    if (opts.lead && !existing.is_lead) await setLead(s, partner.id, opts.by);
    return { ok: true, linkId: existing.id, fresh: false };
  }
  // The first planner on a planner held event is the Lead.
  const lead = opts.lead === true || (bookingOf(s).holder === "planner" && !live.some((l) => l.is_lead));
  if (lead) await supabase.from("event_planners").update({ is_lead: false }).eq("session_id", s.id).is("removed_at", null);
  const booking = bookingOf(s);
  const removeToken = opts.via === "staff" && booking.holder === "client" ? crypto.randomBytes(24).toString("hex") : null;
  const { data, error } = await supabase
    .from("event_planners")
    .insert({
      session_id: s.id,
      partner_id: partner.id,
      is_lead: lead,
      linked_via: opts.via,
      linked_by_name: opts.by.name,
      linked_at: (opts.now ?? new Date()).toISOString(),
      remove_token_hash: removeToken ? hashToken(removeToken) : null,
    })
    .select("*")
    .single();
  if (error || !data) return fail("Could not link the planner. Try again.", 500);
  const link = data as PlannerLink;
  await ensurePartnerKey(s);
  if (lead) await setPlannerLabel(s.id);
  await logActivity(s.id, opts.by, "Planner added", `${partner.name || partner.phone}${partner.company ? ` (${partner.company})` : ""}${lead ? ", Lead" : ""}`, partner.id);

  const ed = s.event_data ?? {};
  await sendPartnerText(
    s,
    partner.phone,
    partner.name,
    plannerWelcomeText({ name: partner.name, eventFor: eventForName(booking, ed.client_name), eventType: str(ed.event_type), signInLink: signInLink() })
  );
  if (removeToken) {
    const phone = clientPhone(s);
    if (phone) await sendPartnerText(s, phone, str(ed.client_name), clientPlannerAddedText(partner, `${siteOrigin()}/remove/${removeToken}`));
  }
  return { ok: true, linkId: link.id, fresh: true };
}

/**
 * Remove a planner. Their access ends on the next request (every partner page
 * and action checks for a live link), including through old links. Their row
 * stays, so the activity log keeps their history for admins and managers. A
 * removed Lead with other planners left alerts the admins to pick a new Lead.
 */
export async function removePlanner(s: EventSession, partnerId: string, by: Actor, now: Date = new Date()): Promise<Result<{ wasLead: boolean }>> {
  const link = (await liveLinks(s.id)).find((l) => l.partner_id === partnerId);
  if (!link) return fail("That planner is not on this event.", 404);
  const { data: done, error } = await supabase
    .from("event_planners")
    .update({ removed_at: now.toISOString(), removed_by_name: by.name, is_lead: false, remove_token_hash: null })
    .eq("id", link.id)
    .is("removed_at", null)
    .select("id");
  if (error) return fail("Could not remove the planner. Try again.", 500);
  if (!done || (done as unknown[]).length === 0) return { ok: true, wasLead: false };
  const partners = await partnersByIds([partnerId]);
  const p = partners.get(partnerId);
  await logActivity(s.id, by, "Planner removed", p ? p.name || p.phone : "", partnerId);
  if (link.is_lead) {
    await setPlannerLabel(s.id);
    const left = await liveLinks(s.id);
    if (left.length > 0 || bookingOf(s).holder === "planner") {
      const ed = eventData(s);
      const message = leadRemovedAdminText({ title: adminEventTitle(ed), date: shortDate(eventSchedule(ed).day), link: `${siteOrigin()}${managerHref(s.id)}` });
      const admins = await alertAdmins();
      await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
    }
  }
  return { ok: true, wasLead: link.is_lead };
}

/** Admins and managers: make this planner the Lead. */
export async function setLead(s: EventSession, partnerId: string, by: Actor): Promise<Result> {
  const live = await liveLinks(s.id);
  const target = live.find((l) => l.partner_id === partnerId);
  if (!target) return fail("That planner is not on this event.", 404);
  if (target.is_lead) return { ok: true };
  await supabase.from("event_planners").update({ is_lead: false }).eq("session_id", s.id).is("removed_at", null);
  const { error } = await supabase.from("event_planners").update({ is_lead: true }).eq("id", target.id);
  if (error) return fail("Could not change the Lead. Try again.", 500);
  await setPlannerLabel(s.id);
  const p = (await partnersByIds([partnerId])).get(partnerId);
  await logActivity(s.id, by, "Lead changed", p ? p.name || p.phone : "", partnerId);
  return { ok: true };
}

/** Admins and managers: who holds the booking, recorded with who changed it and when. */
export async function setBookingHolder(s: EventSession, holder: BookingHolder, by: Actor, now: Date = new Date()): Promise<Result> {
  const { error } = await supabase
    .from("sessions")
    .update({ booking_holder: holder, booking_holder_set_by: by.name, booking_holder_set_at: now.toISOString() })
    .eq("id", s.id);
  if (error) return fail("Could not save. The partners update may not be live yet.", 500);
  s.booking_holder = holder;
  await logActivity(s.id, by, "Booking holder set", holder === "planner" ? "A planner holds the booking" : "The client holds the booking");
  if (holder === "planner") {
    const live = await liveLinks(s.id);
    if (live.length > 0 && !live.some((l) => l.is_lead)) await setLead(s, live[0].partner_id, by);
    else await setPlannerLabel(s.id);
  }
  return { ok: true };
}

/** Set or clear the host. A host with a phone can sign in and view the event read only, and gets a welcome text the first time. */
export async function setHost(s: EventSession, input: { name?: unknown; phone?: unknown; email?: unknown }, by: Actor): Promise<Result> {
  const name = cleanField(input.name, 80);
  const rawPhone = str(input.phone);
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) return fail("Enter the host's phone number, or leave it blank.");
  const email = cleanEmail(input.email);
  // A surprise event: the guest of honor's contact is never a host login, and the host gets no login (and no welcome text) at all.
  if (name && surpriseOn(s)) {
    if (isHonoree(s, { phone, email })) return fail(honoreeRefusal("host login"), 409);
    if (phone) return fail(HOST_SURPRISE_REFUSAL, 409);
  }
  const patch = name ? { host_name: name, host_phone: phone, host_email: email || null } : { host_name: null, host_phone: null, host_email: null };
  const hadPhone = s.host_phone ?? null;
  const { error } = await supabase.from("sessions").update(patch).eq("id", s.id);
  if (error) return fail("Could not save. The partners update may not be live yet.", 500);
  Object.assign(s, patch);
  await logActivity(s.id, by, name ? "Host set" : "Host cleared", name);
  if (phone && phone !== hadPhone && !surpriseOn(s)) {
    await ensurePartnerKey(s);
    await sendPartnerText(s, phone, name, hostWelcomeText({ hostName: name, eventType: str(s.event_data?.event_type), signInLink: signInLink() }));
  }
  return { ok: true };
}

export async function setSwitch(s: EventSession, sw: PricingSwitch, on: boolean, by: Actor): Promise<Result> {
  const { error } = await supabase.from("sessions").update({ [sw]: on }).eq("id", s.id);
  if (error) return fail("Could not save. Try again.", 500);
  (s as unknown as Record<string, unknown>)[sw] = on;
  const label = sw === "planner_can_see_pricing" ? "Planner can see pricing" : sw === "others_can_see_pricing" ? "Other planners can see pricing" : "Host can see pricing";
  await logActivity(s.id, by, `${label} ${on ? "on" : "off"}`);
  return { ok: true };
}

// ----- Access: who the signed in partner or host is on one event -----

export interface EventAccess {
  session: EventSession;
  booking: Booking;
  viewer: EventViewer;
  actor: Actor;
}

export async function sessionByKey(key: string): Promise<EventSession | null> {
  if (!key) return null;
  const { data, error } = await supabase.from("sessions").select("*").eq("partner_key", key).maybeSingle();
  if (error) return null;
  return (data as EventSession | null) ?? null;
}

/**
 * The one check every partner and host page and action makes: the person is
 * signed in and active (getCurrentPrincipal) and linked to this event right
 * now. A planner needs a live link; a host needs their phone on the event.
 */
export async function eventAccess(principal: Principal | null, key: string): Promise<EventAccess | null> {
  if (!principal) return null;
  const s = await sessionByKey(key);
  if (!s) return null;
  const booking = bookingOf(s);
  if (principal.kind === "partner") {
    if (!principal.partner.active) return null;
    const link = (await liveLinks(s.id)).find((l) => l.partner_id === principal.partner.id);
    if (!link) return null;
    return {
      session: s,
      booking,
      viewer: { kind: "planner", partnerId: principal.partner.id, isLead: link.is_lead, name: principal.partner.name },
      actor: { kind: "planner", name: principal.partner.name || principal.partner.phone, partnerId: principal.partner.id },
    };
  }
  if (!s.host_phone || s.host_phone !== principal.phone) return null;
  if (surpriseOn(s)) return null; // a surprise event: the host has no access until the block lifts
  return { session: s, booking, viewer: { kind: "host", name: s.host_name ?? "" }, actor: { kind: "host", name: s.host_name ?? "Host" } };
}

/** Every event this partner is linked to right now, or this host is on. */
export async function eventsFor(principal: Principal): Promise<{ session: EventSession; isLead: boolean }[]> {
  if (principal.kind === "partner") {
    const links = await liveLinksForPartner(principal.partner.id);
    const out: { session: EventSession; isLead: boolean }[] = [];
    for (const l of links) {
      const s = (await getSession(l.session_id)) as EventSession | null;
      if (s) out.push({ session: s, isLead: l.is_lead });
    }
    return out;
  }
  const { data, error } = await supabase.from("sessions").select("*").eq("host_phone", principal.phone);
  if (error || !data) return [];
  return (data as EventSession[]).filter((session) => !surpriseOn(session)).map((session) => ({ session, isLead: false }));
}

/** The booking holder's name and phone: the client, or the Lead planner on a planner held event. */
export async function holderContact(s: EventSession): Promise<{ name: string; phone: string; partnerId: string | null } | null> {
  const b = bookingOf(s);
  if (b.holder === "client") {
    const phone = clientPhone(s);
    return { name: str(s.event_data?.client_name) || str(s.name), phone, partnerId: null };
  }
  const lead = (await plannersOn(s.id)).find((p) => p.isLead);
  return lead ? { name: lead.partner.name, phone: lead.partner.phone, partnerId: lead.partner.id } : null;
}

/** The Lead planner on this event, or null. */
export async function leadOn(sessionId: string): Promise<Partner | null> {
  return (await plannersOn(sessionId)).find((p) => p.isLead)?.partner ?? null;
}

/**
 * True when the Lead on a planner held event is no longer the booking contact
 * (the phone the booking came in with), so GHL's payment reminders still go to
 * the old contact until someone updates it there.
 */
export function leadMoved(s: EventSession, lead: Pick<Partner, "phone"> | null): boolean {
  if (bookingOf(s).holder !== "planner" || !lead) return false;
  const booked = clientPhone(s);
  return !!booked && normalizePhone(lead.phone) !== booked;
}

/**
 * Admins and managers: turn Surprise on or off and edit the guest of honor.
 * The guest of honor's phone or email can never be a number this event
 * already contacts (the client phone, the day of contact, a planner, or the
 * host's login). Every change is logged in partner activity.
 */
export async function setSurprise(
  s: EventSession,
  input: { on?: unknown; name?: unknown; phone?: unknown; email?: unknown },
  by: Actor,
  now: Date = new Date()
): Promise<Result> {
  const on = input.on === true;
  const before = surpriseOf(s);
  const name = cleanField(input.name, 80) || (on ? before.name || str(s.host_name) : before.name);
  const rawPhone = str(input.phone);
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) return fail("Enter the guest of honor's phone number, or leave it blank.");
  const rawEmail = str(input.email);
  const email = cleanEmail(rawEmail);
  if (rawEmail && !email) return fail("Enter a valid email, or leave it blank.");
  if (on && !name) return fail("Enter the guest of honor's name.");
  if (on && (phone || email)) {
    const clash = await contactClash(s, phone, email);
    if (clash) return fail(clash, 409);
  }
  const patch = {
    is_surprise: on,
    honoree_name: name || null,
    honoree_phone: phone,
    honoree_email: email || null,
    surprise_set_by: by.name,
    surprise_set_at: now.toISOString(),
  };
  const { error } = await supabase.from("sessions").update(patch).eq("id", s.id);
  if (error) return fail("Could not save. The surprise events update may not be live yet.", 500);
  Object.assign(s, patch);
  const who = name ? `Guest of honor: ${name}` : "";
  if (on !== before.on) await logActivity(s.id, by, on ? "Surprise turned on" : "Surprise turned off", who);
  else if (on) await logActivity(s.id, by, "Guest of honor changed", [who, phone ? "phone saved" : "", email ? "email saved" : ""].filter(Boolean).join(", "));
  else await logActivity(s.id, by, "Surprise details changed", who);
  return { ok: true };
}

/** Where this phone or email is already saved on the event, as a refusal, or null. */
async function contactClash(s: EventSession, phone: string | null, email: string): Promise<string | null> {
  const ed = s.event_data ?? {};
  const same = (v: unknown) => !!phone && normalizePhone(v) === phone;
  const sameEmail = (v: unknown) => !!email && str(v).toLowerCase() === email;
  const msg = (where: string) => `That is already saved as ${where} on this event. The guest of honor is never contacted, so it cannot be theirs too. Change ${where} first.`;
  if (same(clientPhone(s)) || sameEmail(ed.email) || sameEmail(ed.client_email) || sameEmail(s.email)) return msg("the client's contact");
  if (same(ed.day_of_contact_phone)) return msg("the day of contact");
  if (same(s.host_phone)) return msg("the host's login");
  for (const p of await plannersOn(s.id)) if (same(p.partner.phone) || sameEmail(p.partner.email)) return msg("a planner");
  return null;
}

// ----- The client's one tap remove link -----

export async function linkByRemoveToken(token: string): Promise<{ link: PlannerLink; partner: Partner | null; session: EventSession | null } | null> {
  if (!token || token.length < 20) return null;
  const { data, error } = await supabase.from("event_planners").select("*").eq("remove_token_hash", hashToken(token)).is("removed_at", null).maybeSingle();
  if (error || !data) return null;
  const link = data as PlannerLink;
  const partner = (await partnersByIds([link.partner_id])).get(link.partner_id) ?? null;
  const session = (await getSession(link.session_id)) as EventSession | null;
  return { link, partner, session };
}

// ----- Admin lists -----

export interface PartnerListRow extends Partner {
  upcoming: number;
  past: number;
  holds: number;
}

export async function listPartners(today: string): Promise<PartnerListRow[] | null> {
  const { data, error } = await supabase.from("partners").select(PARTNER_COLUMNS).order("name", { ascending: true });
  if (error || !data) return null; // before the migration
  const partners = data as Partner[];
  const { data: linkData } = await supabase.from("event_planners").select("*").is("removed_at", null);
  const links = (linkData as PlannerLink[] | null) ?? [];
  const ids = [...new Set(links.map((l) => l.session_id))];
  const sessions = new Map<string, EventSession>();
  if (ids.length > 0) {
    const { data: sd } = await supabase.from("sessions").select("*").in("id", ids);
    for (const s of (sd as EventSession[] | null) ?? []) sessions.set(s.id, s);
  }
  return partners.map((p) => {
    const mine = links.filter((l) => l.partner_id === p.id);
    let upcoming = 0;
    let past = 0;
    let holds = 0;
    for (const l of mine) {
      const s = sessions.get(l.session_id);
      if (!s) continue;
      const day = eventSchedule(eventData(s)).day;
      if (day && day < today) past++;
      else upcoming++;
      if (l.is_lead && bookingOf(s).holder === "planner") holds++;
    }
    return { ...p, upcoming, past, holds };
  });
}

/** Every event a partner was ever linked to, with how and whether they are still on it. Admins only. */
export async function partnerEventLinks(partnerId: string): Promise<{ link: PlannerLink; session: EventSession }[]> {
  const links = await linksWhere("partner_id", partnerId, false);
  const out: { link: PlannerLink; session: EventSession }[] = [];
  for (const link of links) {
    const s = (await getSession(link.session_id)) as EventSession | null;
    if (s) out.push({ link, session: s });
  }
  return out;
}

/** The planners on each of these events, for the admin Clients page. Empty before the migration. */
export async function plannersBySession(sessionIds: string[]): Promise<Map<string, { name: string; company: string; isLead: boolean }[]>> {
  const out = new Map<string, { name: string; company: string; isLead: boolean }[]>();
  if (sessionIds.length === 0) return out;
  const { data, error } = await supabase.from("event_planners").select("*").in("session_id", sessionIds).is("removed_at", null);
  if (error || !data) return out;
  const links = data as PlannerLink[];
  const partners = await partnersByIds([...new Set(links.map((l) => l.partner_id))]);
  for (const l of links) {
    const p = partners.get(l.partner_id);
    if (!p) continue;
    const list = out.get(l.session_id) ?? [];
    list.push({ name: p.name || p.phone, company: p.company, isLead: l.is_lead });
    out.set(l.session_id, list);
  }
  return out;
}
