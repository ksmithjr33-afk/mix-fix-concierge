// Every partner, client, and staff action on planners, each with its own
// permission check on the server. Routes call these and nothing else. Server only.

import { getSession } from "@/lib/event-updates";
import type { StaffMember } from "@/lib/team/event-view";
import { isAdminRole, isFullAdmin } from "@/lib/team/roles";
import { canAddPlanner, canRemovePlanner, canSetSwitch, holdsBooking, type PricingSwitch } from "@/lib/partners/rules";
import { approvalByToken, decideApproval, getApproval } from "@/lib/partners/approvals";
import {
  findOrCreatePlanner,
  linkByRemoveToken,
  linkPlanner,
  plannersOn,
  removePlanner,
  setBookingHolder,
  setHost,
  setLead,
  setSwitch,
  type Actor,
  type EventAccess,
  type EventSession,
  type PartnerInput,
  type Result,
} from "@/lib/partners/db";
import { bookingOf } from "@/lib/partners/rules";

const fail = (error: string, status = 403) => ({ ok: false as const, error, status });
const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const SWITCHES: PricingSwitch[] = ["planner_can_see_pricing", "others_can_see_pricing", "host_can_see_pricing"];

// ----- The Lead planner -----

export async function leadAddPlanner(a: EventAccess, input: PartnerInput): Promise<Result> {
  if (!canAddPlanner(a.booking, a.viewer)) return fail("Only the Lead planner can add planners to this event.");
  const found = await findOrCreatePlanner(input, a.actor.name);
  if (!found.ok) return found;
  const linked = await linkPlanner(a.session, found.partner, { via: "lead", by: a.actor });
  return linked.ok ? { ok: true } : linked;
}

export async function leadRemovePlanner(a: EventAccess, partnerId: string): Promise<Result> {
  const target = (await plannersOn(a.session.id)).find((p) => p.partner.id === partnerId);
  if (!target) return fail("That planner is not on this event.", 404);
  if (!canRemovePlanner(a.booking, a.viewer, { partnerId, isLead: target.isLead })) return fail("Only the Lead can remove other planners. Our team changes the Lead.");
  const r = await removePlanner(a.session, partnerId, a.actor);
  return r.ok ? { ok: true } : r;
}

export async function leadSetSwitch(a: EventAccess, sw: unknown, on: unknown): Promise<Result> {
  if (!SWITCHES.includes(sw as PricingSwitch)) return fail("Unknown switch.", 400);
  if (!canSetSwitch(a.booking, a.viewer, sw as PricingSwitch)) return fail("Only the Lead planner can change that.");
  return setSwitch(a.session, sw as PricingSwitch, on === true, a.actor);
}

/** The Lead on a planner held event answers a price change. Nobody else on the partner side can. */
export async function leadDecide(a: EventAccess, approvalId: string, yes: boolean): Promise<Result> {
  if (!holdsBooking(a.booking, a.viewer)) return fail("Only the person who holds the booking can approve a price change.");
  const ap = await getApproval(approvalId);
  if (!ap || ap.session_id !== a.session.id || ap.holder !== "planner") return fail("We could not find that change.", 404);
  const r = await decideApproval(ap, yes, a.actor);
  return r.ok ? { ok: true } : r;
}

// ----- The client (by their own event link) -----

export async function clientAddPlanner(s: EventSession, input: PartnerInput): Promise<Result> {
  if (!canAddPlanner(bookingOf(s), "client")) return fail("Your planner manages planners on this event.");
  const name = str(s.event_data?.client_name) || "Client";
  const found = await findOrCreatePlanner(input, name);
  if (!found.ok) return found;
  const linked = await linkPlanner(s, found.partner, { via: "client", by: { kind: "client", name } });
  return linked.ok ? { ok: true } : linked;
}

export async function clientRemovePlanner(s: EventSession, partnerId: string): Promise<Result> {
  const target = (await plannersOn(s.id)).find((p) => p.partner.id === partnerId);
  if (!target) return fail("That planner is not on your event.", 404);
  if (!canRemovePlanner(bookingOf(s), "client", { partnerId, isLead: target.isLead })) return fail("Your planner manages planners on this event.");
  const r = await removePlanner(s, partnerId, { kind: "client", name: str(s.event_data?.client_name) || "Client" });
  return r.ok ? { ok: true } : r;
}

export async function clientSetPricing(s: EventSession, on: boolean): Promise<Result> {
  if (!canSetSwitch(bookingOf(s), "client", "planner_can_see_pricing")) return fail("This switch is only for events you booked yourself.");
  return setSwitch(s, "planner_can_see_pricing", on, { kind: "client", name: str(s.event_data?.client_name) || "Client" });
}

/** The client's one tap remove link from the text. Works once, and only while that planner is still on the event. */
export async function removeByToken(token: string): Promise<Result<{ plannerName: string }>> {
  const found = await linkByRemoveToken(token);
  if (!found || !found.session) return fail("This link is no longer active.", 404);
  const r = await removePlanner(found.session, found.link.partner_id, { kind: "client", name: str(found.session.event_data?.client_name) || "Client" });
  if (!r.ok) return r;
  return { ok: true, plannerName: found.partner?.name || "Your planner" };
}

/** The client answers a price change a planner asked for, by the link in their text. */
export async function clientDecideByToken(token: string, yes: boolean): Promise<Result<{ status: string }>> {
  const ap = await approvalByToken(token);
  if (!ap || ap.holder !== "client") return fail("This link is no longer active.", 404);
  const s = (await getSession(ap.session_id)) as EventSession | null;
  if (!s || bookingOf(s).holder !== "client") return fail("This link is no longer active.", 404);
  const r = await decideApproval(ap, yes, { kind: "client", name: str(s.event_data?.client_name) || "Client" });
  return r.ok ? { ok: true, status: r.status } : r;
}

// ----- Admins and managers, on the event's Booking card -----

/**
 * One action from the Booking card. Admins and managers can do all of it,
 * except "Planner can see pricing", which is the client's or an admin's.
 */
export async function staffBookingAction(staff: StaffMember, s: EventSession, body: Record<string, unknown>): Promise<Result> {
  if (!isAdminRole(staff.role)) return fail("Admins and managers only.");
  const by: Actor = { kind: "staff", name: staff.name || "Our team" };
  const action = str(body.action);
  switch (action) {
    case "holder":
      return setBookingHolder(s, body.holder === "planner" ? "planner" : "client", by);
    case "host":
      return setHost(s, { name: body.name, phone: body.phone, email: body.email }, by);
    case "add": {
      const found = await findOrCreatePlanner(body as PartnerInput, by.name);
      if (!found.ok) return found;
      const r = await linkPlanner(s, found.partner, { via: "staff", by, lead: body.lead === true });
      return r.ok ? { ok: true } : r;
    }
    case "remove": {
      const r = await removePlanner(s, str(body.partnerId), by);
      return r.ok ? { ok: true } : r;
    }
    case "replace": {
      // Remove one planner and add another in one step; the new one keeps the Lead if the old one had it.
      const target = (await plannersOn(s.id)).find((p) => p.partner.id === str(body.partnerId));
      if (!target) return fail("That planner is not on this event.", 404);
      const found = await findOrCreatePlanner(body as PartnerInput, by.name);
      if (!found.ok) return found;
      if (found.partner.id === target.partner.id) return fail("That is the same planner.", 400);
      const removed = await removePlanner(s, target.partner.id, by);
      if (!removed.ok) return removed;
      const fresh = ((await getSession(s.id)) as EventSession | null) ?? s;
      const r = await linkPlanner(fresh, found.partner, { via: "staff", by, lead: target.isLead });
      return r.ok ? { ok: true } : r;
    }
    case "lead":
      return setLead(s, str(body.partnerId), by);
    case "switch": {
      const sw = str(body.switch) as PricingSwitch;
      if (sw !== "planner_can_see_pricing") return fail("Only the Lead planner changes that switch.");
      if (!isFullAdmin(staff.role)) return fail("Only an admin or the client can turn on Planner can see pricing.");
      if (bookingOf(s).holder !== "client") return fail("That switch is for events the client holds.", 400);
      return setSwitch(s, sw, body.on === true, by);
    }
    default:
      return fail("Unknown action.", 400);
  }
}
