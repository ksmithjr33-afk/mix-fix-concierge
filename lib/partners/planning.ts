// What happens around the planning chat when planners are involved. Server
// only. Never throws: nothing here may block the client's or planner's chat.

import { getSession } from "@/lib/event-updates";
import { siteOrigin } from "@/lib/team/clock-db";
import { supabase } from "@/lib/supabase";
import { bookingOf, eventForName, firstWord, holdsBooking, planningNoticeText } from "@/lib/partners/rules";
import type { BookingAnswers, PlannerChatContext } from "@/lib/partners/chat";
import { askForApproval } from "@/lib/partners/approvals";
import {
  clientEventLink,
  clientPhone,
  ensurePartnerKey,
  findOrCreatePlanner,
  holderContact,
  linkPlanner,
  logActivity,
  partnerEventHref,
  plannersOn,
  setBookingHolder,
  setHost,
  type Actor,
  type EventAccess,
  type EventSession,
} from "@/lib/partners/db";
import { sendPartnerText } from "@/lib/partners/texts";

const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

const CONCIERGE: Actor = { kind: "system", name: "Concierge" };

/**
 * The client chat's booking answers, once the planning is submitted (item 6a
 * and 9c). A planner booking for a client: the event is marked as held by a
 * planner, the host is set, and a partner account is matched or created from
 * the booking contact's phone and linked as Lead. A client working with a
 * planner: that planner is matched or created and linked.
 */
export async function applyBookingAnswers(sessionId: string, answers: BookingAnswers): Promise<void> {
  try {
    const s = (await getSession(sessionId)) as EventSession | null;
    if (!s) return;
    if (answers.role || answers.planner) await supabase.from("sessions").update({ planner_asked: true }).eq("id", sessionId);
    const ed = s.event_data ?? {};
    const clientName = str(ed.client_name) || str(s.name);
    if (answers.role === "planner") {
      const phone = clientPhone(s);
      await setBookingHolder(s, "planner", CONCIERGE);
      if (answers.host) await setHost(s, answers.host, CONCIERGE);
      if (!phone) {
        console.error(`[partners] ${sessionId}: a planner booked it but there is no booking phone to make their account from`);
        return;
      }
      const found = await findOrCreatePlanner({ phone, name: clientName, email: ed.email ?? ed.client_email }, "Concierge");
      if (!found.ok) {
        console.error(`[partners] ${sessionId}: planner account not made: ${found.error}`);
        return;
      }
      await linkPlanner(s, found.partner, { via: "booked", by: { kind: "planner", name: found.partner.name || clientName, partnerId: found.partner.id }, lead: true });
      return;
    }
    if (answers.planner) {
      const found = await findOrCreatePlanner({ phone: answers.planner.phone, name: answers.planner.name, company: answers.planner.company }, clientName || "Client");
      if (!found.ok) {
        console.error(`[partners] ${sessionId}: client's planner not linked: ${found.error}`);
        return;
      }
      await linkPlanner(s, found.partner, { via: "client", by: { kind: "client", name: clientName || "Client" } });
    }
  } catch (err) {
    console.error(`[partners] ${sessionId} booking answers failed:`, err instanceof Error ? err.message : String(err));
  }
}

/** The chat context for a planner on this event. */
export async function plannerChatContext(a: EventAccess): Promise<PlannerChatContext> {
  const ed = a.session.event_data ?? {};
  const holder = await holderContact(a.session);
  return {
    plannerName: a.viewer.name,
    // Before the planning is in, event_data is empty: the booking's own name and type.
    eventFor: eventForName(a.booking, ed.client_name || a.session.name),
    eventType: str(ed.event_type) || str(a.session.event_type),
    holdsBooking: holdsBooking(a.booking, a.viewer),
    holderFirstName: firstWord(holder?.name) || (a.booking.holder === "client" ? "the client" : "the Lead planner"),
  };
}

/**
 * Item 21: a planner submitted the planning or saved a change. On a client
 * held event the client gets a short summary with a link to review it; on a
 * planner held event the Lead does, unless the Lead made it. Logged either way.
 */
export async function plannerChanged(a: EventAccess, o: { submitted: boolean; summary: string }): Promise<void> {
  try {
    await logActivity(a.session.id, a.actor, o.submitted ? "Submitted the planning" : "Saved a change", o.summary);
    const s = ((await getSession(a.session.id)) as EventSession | null) ?? a.session;
    const b = bookingOf(s);
    if (b.holder === "client") {
      const phone = clientPhone(s);
      if (phone) await sendPartnerText(s, phone, str(s.event_data?.client_name), planningNoticeText({ who: a.actor.name, submitted: o.submitted, summary: o.summary, link: clientEventLink(s.id) }));
      return;
    }
    const lead = (await plannersOn(s.id)).find((p) => p.isLead);
    if (!lead || lead.partner.id === a.actor.partnerId) return;
    const key = await ensurePartnerKey(s);
    await sendPartnerText(s, lead.partner.phone, lead.partner.name, planningNoticeText({ who: a.actor.name, submitted: o.submitted, summary: o.summary, link: `${siteOrigin()}${partnerEventHref(key ?? "")}` }));
  } catch (err) {
    console.error(`[partners] ${a.session.id} planner notice failed:`, err instanceof Error ? err.message : String(err));
  }
}

/** A planner who cannot approve asked for a different guest count during intake: once submitted, it goes to the holder. */
export async function requestGuestCountApproval(a: EventAccess, guests: number): Promise<void> {
  try {
    const s = ((await getSession(a.session.id)) as EventSession | null) ?? a.session;
    if (Number(String(s.event_data?.guest_count ?? "").replace(/[^\d]/g, "")) === guests) return;
    await askForApproval(s, { guest_count: guests }, a.actor);
  } catch (err) {
    console.error(`[partners] ${a.session.id} guest count approval failed:`, err instanceof Error ? err.message : String(err));
  }
}
