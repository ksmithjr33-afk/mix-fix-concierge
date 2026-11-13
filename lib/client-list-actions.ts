// Admin actions on the Client list tab of the manager view: Approve or Decline
// a client change request made inside six days (a drink change, or a change to
// their shopping list), and Review and send the first list of an event with a
// custom recipe. Approve applies the request through the normal update path,
// so the lists, the bartenders' supplies list and staff texts all follow.
// Decline changes nothing. GHL hears the outcome either way. Server only,
// admins only.

import { applyEventUpdate, getSession } from "@/lib/event-updates";
import { deliverEventUpdates, postListOnly } from "@/lib/update-delivery";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { changeRequestFields, clientList, clientListFields } from "@/lib/client-list";
import { requestSummary } from "@/lib/change-requests";
import {
  autoSendOn,
  clientListLink,
  decideHold,
  getHold,
  logApprovedNoChange,
  logDecline,
  orderSheetLink,
  releaseFirstList,
  type Actor,
} from "@/lib/client-list-db";

export type HoldResult = { ok: true; message: string } | { ok: false; error: string; status: number };

function actor(admin: StaffMember): Actor {
  return { id: admin.id, name: firstName(admin.name) || "Admin" };
}

async function pendingHold(holdId: unknown, sessionId: unknown, kind: "change" | "custom_recipe") {
  if (typeof holdId !== "string" || typeof sessionId !== "string") return null;
  const hold = await getHold(holdId);
  if (!hold || hold.session_id !== sessionId || hold.kind !== kind) return null;
  return hold;
}

/** Approve: apply the request (no six day cutoff, the engine's price), send the list with reason "approved", and tell GHL. */
export async function approveHold(admin: StaffMember, sessionId: unknown, holdId: unknown, origin: string): Promise<HoldResult> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const hold = await pendingHold(holdId, sessionId, "change");
  if (!hold) return { ok: false, error: "We could not find that held change.", status: 404 };
  if (hold.status !== "pending") return { ok: false, error: "That change was already decided.", status: 409 };
  const by = actor(admin);
  if (!(await decideHold(hold.id, "approved", by))) return { ok: false, error: "That change was already decided.", status: 409 };

  const result = await applyEventUpdate(hold.session_id, hold.partial ?? {}, {
    source: "manager",
    ignoreCutoff: true,
    editor: { name: by.name, staffId: by.id },
  });
  if (!result) return { ok: false, error: "We could not find that event.", status: 404 };

  const outcome = changeRequestFields({ approved: true, summary: requestSummary(hold.changes) });
  if (result.rows.some((r) => r.applied)) {
    await deliverEventUpdates(hold.session_id, result.rows, { staffOrigin: origin, clientList: { mode: "approved", by, holdId: hold.id }, extra: outcome });
    return { ok: true, message: "Approved. The change is saved, and the lists, the bartenders and GHL were updated." };
  }
  // Already on file: nothing to apply, the client still hears it was approved.
  const session = await getSession(hold.session_id);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const enabled = await autoSendOn();
  const fields = clientListFields({ enabled, send: true, reason: "approved", changes: "", url: clientListLink(session.id), list: clientList(session.event_data ?? {}) });
  await postListOnly(session, { ...fields, order_sheet_url: orderSheetLink(session.id), ...outcome });
  await logApprovedNoChange(session, hold, by, { sent: fields.client_shopping_list_send });
  return { ok: true, message: "Approved. It was already on file, so nothing else changed." };
}

/** Decline: the event stays as it is, and GHL gets change_request_declined (and list_change_declined) so it can text the client. */
export async function declineHold(admin: StaffMember, sessionId: unknown, holdId: unknown): Promise<HoldResult> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const hold = await pendingHold(holdId, sessionId, "change");
  if (!hold) return { ok: false, error: "We could not find that held change.", status: 404 };
  const by = actor(admin);
  if (!(await decideHold(hold.id, "declined", by))) return { ok: false, error: "That change was already decided.", status: 409 };
  const session = await getSession(hold.session_id);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const enabled = await autoSendOn();
  const fields = clientListFields({ enabled, send: false, reason: null, changes: "", url: clientListLink(session.id), list: clientList(session.event_data ?? {}), declined: true });
  const summary = requestSummary(hold.changes);
  await postListOnly(session, { ...fields, order_sheet_url: orderSheetLink(session.id), list_change_declined_summary: summary, ...changeRequestFields({ declined: true, summary }) });
  await logDecline(session, hold, by);
  return { ok: true, message: "Declined. The event was not changed, and GHL was told so it can text the client." };
}

/** Review and send: the first list of an event with a custom recipe, after an admin checked it. */
export async function reviewAndSend(admin: StaffMember, sessionId: unknown, holdId: unknown): Promise<HoldResult> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const hold = await pendingHold(holdId, sessionId, "custom_recipe");
  if (!hold) return { ok: false, error: "We could not find that held list.", status: 404 };
  const by = actor(admin);
  if (!(await decideHold(hold.id, "approved", by))) return { ok: false, error: "That list was already sent.", status: 409 };
  const session = await getSession(hold.session_id);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const fields = await releaseFirstList(session, hold.id, by);
  const error = await postListOnly(session, { ...fields });
  if (error) console.error(`[client-list] session ${session.id} review and send:`, error);
  return { ok: true, message: fields.client_shopping_list_send ? "Sent. The client's first list went out." : "Reviewed. Auto send is off, so nothing went to the client." };
}
