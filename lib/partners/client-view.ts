// The client's side of planners, on their own event link (/s). Server only.

import { supabase } from "@/lib/supabase";
import { chicagoStamp, eventTz } from "@/lib/team/time";
import { eventData } from "@/lib/team/markets";
import { billingLines, bookingOf, LEAD_MOVED_WARNING, LINKED_VIA_LABEL } from "@/lib/partners/rules";
import { surpriseLastDay, surpriseOf } from "@/lib/partners/surprise";
import { longDate } from "@/lib/team/time";
import { approvalsFor } from "@/lib/partners/approvals";
import { isFullAdmin } from "@/lib/team/roles";
import { activityFor, clientPhone, leadMoved, liveLinks, plannersOn, surpriseOn, type EventSession } from "@/lib/partners/db";
import { findPartnerByPhone } from "@/lib/partners/auth";

/**
 * The planners card in update mode: client held events only. Null before the
 * partners migration (the read fails), so the page looks exactly as before.
 */
export async function clientPlannersCard(s: EventSession): Promise<{ planners: { id: string; name: string; company: string }[]; pricingOn: boolean; activity: { at: string; who: string; what: string }[] } | null> {
  const { error } = await supabase.from("event_planners").select("id").eq("session_id", s.id).limit(1);
  if (error) return null;
  const b = bookingOf(s);
  if (b.holder !== "client") return null;
  const tz = eventTz(eventData(s));
  const [planners, activity] = await Promise.all([plannersOn(s.id), activityFor(s.id)]);
  return {
    planners: planners.map((p) => ({ id: p.partner.id, name: p.partner.name || "Your planner", company: p.partner.company })),
    pricingOn: b.plannerCanSeePricing,
    // A plain list of what planners did. The client sees every name: they added or approved each planner.
    activity: activity
      .filter((a) => a.actor_kind === "planner" || a.action.startsWith("Planner") || a.action.startsWith("Price change"))
      .slice(0, 30)
      .map((a) => ({ at: chicagoStamp(a.created_at, tz), who: a.actor_name, what: [a.action, a.detail].filter(Boolean).join(", ") })),
  };
}

/**
 * True when the event's own link must not open: a planner held event whose
 * booking contact is a planner who was removed from it or deactivated.
 * Removal ends access on the server, including through old links.
 */
export async function clientLinkBlocked(s: EventSession): Promise<boolean> {
  if (bookingOf(s).holder !== "planner") return false;
  const phone = clientPhone(s);
  if (!phone) return false;
  const partner = await findPartnerByPhone(phone);
  if (!partner) return false; // the booking contact is not a planner (an admin set the holder)
  if (!partner.active) return true;
  return !(await liveLinks(s.id)).some((l) => l.partner_id === partner.id);
}

/** The same check by session id, for the client routes (chat, menu, conversation). Never throws. */
export async function clientLinkBlockedById(sessionId: string | null | undefined): Promise<boolean> {
  if (!sessionId) return false;
  try {
    const { data, error } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
    if (error || !data) return false;
    return await clientLinkBlocked(data as EventSession);
  } catch {
    return false;
  }
}

export interface BookingCardData {
  ready: boolean; // false before the partners migration
  holder: "client" | "planner";
  setBy: string;
  setAt: string;
  host: { name: string; phone: string; contactEmail: string } | null;
  planners: { id: string; name: string; company: string; phone: string; isLead: boolean; via: string; linkedBy: string; linkedAt: string }[];
  switches: { planner: boolean; others: boolean; host: boolean };
  canSetPlannerPricing: boolean; // admins only
  activity: { at: string; who: string; what: string }[];
  approvals: { summary: string; status: string; askedBy: string; at: string }[];
  billing: { billedTo: string; eventFor: string } | null; // planner held: the Lead is billed
  leadMovedWarning: string; // the Lead is not the booking contact GHL knows
  surprise: SurpriseCard;
}

export interface SurpriseCard {
  ready: boolean; // false before the surprise events migration
  on: boolean;
  active: boolean; // the block is in force right now
  name: string;
  phone: string;
  contactEmail: string;
  setBy: string;
  setAt: string;
  liftsAfter: string; // "Saturday, December 12, 2026": the last day of the block
}

/** The surprise section of the Booking card. Admins and managers only. */
export function surpriseCard(s: EventSession): SurpriseCard {
  const x = surpriseOf(s);
  return {
    ready: "is_surprise" in s,
    on: x.on,
    active: surpriseOn(s),
    name: x.name,
    phone: x.phone,
    contactEmail: x.email,
    setBy: x.setBy,
    setAt: x.setAt ? chicagoStamp(x.setAt, eventTz(eventData(s))) : "",
    liftsAfter: longDate(surpriseLastDay(s)),
  };
}

/** The Booking card on the admin Details tab. Admins and managers only (the page checks). Not ready before the migration. */
export async function bookingCardData(s: EventSession, viewerRole: unknown): Promise<BookingCardData> {
  const { error } = await supabase.from("event_planners").select("id").eq("session_id", s.id).limit(1);
  const b = bookingOf(s);
  const tz = eventTz(eventData(s));
  const empty = { ready: false, holder: "client" as const, setBy: "", setAt: "", host: null, planners: [], switches: { planner: false, others: false, host: false }, canSetPlannerPricing: false, activity: [], approvals: [], billing: null, leadMovedWarning: "", surprise: surpriseCard(s) };
  if (error) return empty;
  const [planners, activity, approvals] = await Promise.all([plannersOn(s.id), activityFor(s.id), approvalsFor(s.id)]);
  const lead = planners.find((p) => p.isLead)?.partner ?? null;
  return {
    ready: true,
    billing: billingLines(b, lead),
    leadMovedWarning: leadMoved(s, lead) ? LEAD_MOVED_WARNING : "",
    surprise: surpriseCard(s),
    holder: b.holder,
    setBy: b.setBy,
    setAt: b.setAt ? chicagoStamp(b.setAt, tz) : "",
    host: b.host ? { name: b.host.name, phone: b.host.phone, contactEmail: b.host.email } : null,
    planners: planners.map((p) => ({ id: p.partner.id, name: p.partner.name, company: p.partner.company, phone: p.partner.phone, isLead: p.isLead, via: LINKED_VIA_LABEL[p.linkedVia], linkedBy: p.linkedBy, linkedAt: chicagoStamp(p.linkedAt, tz) })),
    switches: { planner: b.plannerCanSeePricing, others: b.othersCanSeePricing, host: b.hostCanSeePricing },
    canSetPlannerPricing: isFullAdmin(viewerRole),
    // Everything, including removed planners' history: admins and managers only.
    activity: activity.map((a) => ({ at: chicagoStamp(a.created_at, tz), who: a.actor_name, what: [a.action, a.detail].filter(Boolean).join(", ") })),
    approvals: approvals.slice(0, 10).map((a) => ({ summary: a.summary, status: a.status === "pending" ? "Waiting" : a.status[0].toUpperCase() + a.status.slice(1), askedBy: a.asked_by_name, at: chicagoStamp(a.created_at, tz) })),
  };
}

/** "Billed to" and "Event for" on a planner held event, for the admin Business tab. Null on a client held event or before the partners migration. */
export async function billingFor(s: EventSession): Promise<{ billedTo: string; eventFor: string } | null> {
  const b = bookingOf(s);
  if (b.holder !== "planner") return null;
  const lead = (await plannersOn(s.id)).find((p) => p.isLead)?.partner ?? null;
  return billingLines(b, lead);
}
