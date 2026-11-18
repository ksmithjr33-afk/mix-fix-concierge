// What happens around the planning chat when planners are involved. Server
// only. Never throws: nothing here may block the client's or planner's chat.

import { getSession } from "@/lib/event-updates";
import { siteOrigin } from "@/lib/team/clock-db";
import { supabase } from "@/lib/supabase";
import { bookingOf, cleanField, eventForName, firstWord, holdsBooking, planningNoticeText } from "@/lib/partners/rules";
import { honoreeRefusal, isHonoree, planningRoleOf, PLANNING_ROLES, type PlanningRole } from "@/lib/partners/surprise";
import { normalizePhone } from "@/lib/team/codes";
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
    // The opening question and the surprise answer, if save_planning_role did not already save them.
    await saveSurpriseAnswers(s, answers);
    const ed = s.event_data ?? {};
    const clientName = str(ed.client_name) || str(s.name);
    if (answers.role === "someone_else") {
      // Hosting for someone else: still client held, and the person it is for is the host by name only.
      if (answers.host && str(s.host_name) !== answers.host.name) await setHost(s, { name: answers.host.name }, CONCIERGE);
    }
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

const ROLE_OF: Record<NonNullable<BookingAnswers["role"]>, PlanningRole> = { self: "guest_of_honor", someone_else: "someone_else", planner: "planner" };

/** The opening question's answer and the surprise answer from submit_event_data, saved once. Before the surprise migration the save fails quietly. */
async function saveSurpriseAnswers(s: EventSession, answers: BookingAnswers): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (answers.role && !planningRoleOf(s)) patch.planning_role = ROLE_OF[answers.role];
  if (answers.surprise && !s.surprise_set_at && s.is_surprise !== true) {
    patch.is_surprise = answers.surprise.on;
    patch.honoree_name = answers.surprise.on ? answers.surprise.honoreeName || answers.host?.name || null : null;
    patch.surprise_set_by = "Concierge";
    patch.surprise_set_at = new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from("sessions").update(patch).eq("id", s.id);
  if (error) return;
  Object.assign(s, patch);
  if (patch.is_surprise === true) await logActivity(s.id, CONCIERGE, "Surprise turned on", patch.honoree_name ? `Guest of honor: ${patch.honoree_name}` : "");
}

/**
 * save_planning_role, during the planning chat: the opening question, the
 * surprise question, and the private number, saved the moment they are
 * answered so neither question is ever asked again. Never on a submitted
 * event. The guest of honor's number is refused as the client phone.
 */
export async function savePlanningRole(sessionId: string, input: Record<string, unknown>, now: Date = new Date()): Promise<{ saved: boolean; refused?: string }> {
  try {
    const s = (await getSession(sessionId)) as EventSession | null;
    if (!s || s.status === "submitted") return { saved: false };
    const rawPhone = str(input.private_phone);
    if (rawPhone && isHonoree(s, { phone: rawPhone })) return { saved: false, refused: honoreeRefusal("client phone") };
    if (rawPhone && !normalizePhone(rawPhone)) return { saved: false, refused: "That does not look like a US mobile number." };
    const patch: Record<string, unknown> = {};
    const role = (PLANNING_ROLES as unknown[]).includes(input.role) ? (input.role as PlanningRole) : null;
    if (role && !planningRoleOf(s)) patch.planning_role = role;
    const effective = planningRoleOf(s) ?? role;
    const hostName = cleanField(input.host_name, 80);
    if (typeof input.is_surprise === "boolean" && (effective === "someone_else" || effective === "planner") && !s.surprise_set_at && s.is_surprise !== true) {
      patch.is_surprise = input.is_surprise;
      patch.honoree_name = input.is_surprise ? cleanField(input.honoree_name, 80) || hostName || str(s.host_name) || null : null;
      patch.surprise_set_by = "Concierge";
      patch.surprise_set_at = now.toISOString();
    }
    let saved = false;
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from("sessions").update(patch).eq("id", s.id);
      if (!error) {
        saved = true;
        Object.assign(s, patch);
        if (patch.is_surprise === true) await logActivity(s.id, CONCIERGE, "Surprise turned on", patch.honoree_name ? `Guest of honor: ${patch.honoree_name}` : "");
      }
    }
    // The person it is for, by name only (never a phone or email here). The booking stays client held until a planner's planning is in.
    if (hostName && (effective === "someone_else" || effective === "planner") && !str(s.host_name)) {
      const r = await setHost(s, { name: hostName }, CONCIERGE);
      saved = saved || r.ok;
    }
    return { saved: saved || !!rawPhone };
  } catch (err) {
    console.error(`[partners] ${sessionId} planning role save failed:`, err instanceof Error ? err.message : String(err));
    return { saved: false };
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
