// Price changes asked for by someone who does not hold the booking (item 18).
// The change is quoted the same way update mode quotes it, saved as a pending
// approval, and sent to the booking holder: the client by a text link, or the
// Lead planner in the partner portal. Nothing is applied unless the holder
// says yes before it expires; a no, or no answer, leaves the event as it was.
// Server only.

import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { PRICED_FIELDS, recapLines, sameValue, type EventData } from "@/lib/event-diff";
import { applyEventUpdate, getSession, quoteEventUpdate } from "@/lib/event-updates";
import { deliverEventUpdates } from "@/lib/update-delivery";
import { hashToken } from "@/lib/team/codes";
import { siteOrigin } from "@/lib/team/clock-db";
import { alertAdmins } from "@/lib/team/events";
import { sendStaffText } from "@/lib/team/sms";
import { eventData } from "@/lib/team/markets";
import { adminEventTitle } from "@/lib/team/event-list";
import { managerHref } from "@/lib/team/manager-tabs";
import { sendPartnerText } from "@/lib/partners/texts";
import { approvalAskText, APPROVAL_HOURS, bookingOf, firstWord } from "@/lib/partners/rules";
import { ensurePartnerKey, holderContact, logActivity, partnerEventHref, partnersByIds, type Actor, type EventSession } from "@/lib/partners/db";

export interface ApprovalRow {
  id: string;
  session_id: string;
  partner_id: string | null;
  asked_by_name: string;
  changes: EventData;
  summary: string;
  amount: number | null;
  new_total: number | null;
  price_text: string;
  holder: "client" | "planner";
  status: "pending" | "approved" | "declined" | "expired" | "stale";
  expires_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  created_at: string;
}

/** Split a change into the fields that can change the price and everything else. */
export function splitPriced(partial: EventData): { priced: EventData; rest: EventData } {
  const priced: EventData = {};
  const rest: EventData = {};
  for (const [k, v] of Object.entries(partial)) ((PRICED_FIELDS as readonly string[]).includes(k) ? priced : rest)[k] = v;
  return { priced, rest };
}

/** The priced fields that differ from what is on file. Empty when nothing priced really changes. */
export function changedPriced(current: EventData, priced: EventData): EventData {
  return Object.fromEntries(Object.entries(priced).filter(([k, v]) => !sameValue(current[k], v)));
}

export type AskResult =
  | { kind: "no_price" } // nothing about the price changes: save it the normal way
  | { kind: "sent"; holderFirstName: string; approvalId: string }
  | { kind: "failed" };

/**
 * Quote a priced change for someone who cannot accept it, and send it to the
 * booking holder. "no_price" when the quote shows no change in price (a time
 * shift that keeps the same hours, say), so it can be saved the normal way.
 */
export async function askForApproval(s: EventSession, priced: EventData, by: Actor, now: Date = new Date()): Promise<AskResult> {
  try {
    const quote = await quoteEventUpdate(s.id, priced, now);
    if (!quote) return { kind: "failed" };
    const price = quote.price;
    if (!price || (price.amount === 0 && price.new_total !== null)) return { kind: "no_price" };
    const b = bookingOf(s);
    const holder = await holderContact(s);
    const token = b.holder === "client" ? crypto.randomBytes(24).toString("hex") : null;
    const summary = recapLines(price.changes.concat(price.implied ?? [])).join("; ") || price.summary;
    const { data, error } = await supabase
      .from("price_approvals")
      .insert({
        session_id: s.id,
        partner_id: by.partnerId ?? null,
        asked_by_name: by.name,
        changes: priced,
        summary,
        amount: price.amount,
        new_total: price.new_total,
        price_text: price.price_text,
        holder: b.holder,
        token_hash: token ? hashToken(token) : null,
        status: "pending",
        expires_at: new Date(now.getTime() + APPROVAL_HOURS * 3_600_000).toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) return { kind: "failed" };
    const id = (data as { id: string }).id;
    await logActivity(s.id, by, "Price change sent for approval", summary);

    if (holder?.phone) {
      const link = token ? `${siteOrigin()}/approve/${token}` : `${siteOrigin()}${partnerEventHref((await ensurePartnerKey(s)) ?? "")}`;
      await sendPartnerText(s, holder.phone, holder.name, approvalAskText({ askedBy: by.name, summary, priceText: price.price_text, link }));
    } else {
      // A planner held event with no Lead right now: the admins pick one, and the change waits.
      const admins = await alertAdmins();
      const msg = `A price change on ${adminEventTitle(eventData(s))} is waiting for a booking holder, and there is no Lead planner. Pick a Lead: ${siteOrigin()}${managerHref(s.id)}`;
      await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, msg)));
    }
    return { kind: "sent", holderFirstName: firstWord(holder?.name) || (b.holder === "client" ? "the client" : "the Lead planner"), approvalId: id };
  } catch (err) {
    console.error(`[price-approval] ${s.id} ask failed:`, err instanceof Error ? err.message : String(err));
    return { kind: "failed" };
  }
}

const expired = (a: ApprovalRow, now: Date) => new Date(a.expires_at).getTime() <= now.getTime();

export async function approvalsFor(sessionId: string, now: Date = new Date()): Promise<ApprovalRow[]> {
  const { data, error } = await supabase.from("price_approvals").select("*").eq("session_id", sessionId).order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as ApprovalRow[]).map((a) => (a.status === "pending" && expired(a, now) ? { ...a, status: "expired" as const } : a));
}

export async function approvalByToken(token: string, now: Date = new Date()): Promise<ApprovalRow | null> {
  if (!token || token.length < 20) return null;
  const { data, error } = await supabase.from("price_approvals").select("*").eq("token_hash", hashToken(token)).maybeSingle();
  if (error || !data) return null;
  const a = data as ApprovalRow;
  return a.status === "pending" && expired(a, now) ? { ...a, status: "expired" } : a;
}

export async function getApproval(id: string): Promise<ApprovalRow | null> {
  const { data, error } = await supabase.from("price_approvals").select("*").eq("id", id).maybeSingle();
  return error ? null : ((data as ApprovalRow | null) ?? null);
}

export type DecideResult = { ok: true; status: ApprovalRow["status"] } | { ok: false; error: string; status: number };

/**
 * The booking holder's answer. A yes applies the change at the quoted total;
 * if the price moved since it was quoted, nothing is applied and it is marked
 * stale so it can be asked again. A no applies nothing. The caller checks the
 * person deciding is the booking holder.
 */
export async function decideApproval(a: ApprovalRow, yes: boolean, by: Actor, now: Date = new Date()): Promise<DecideResult> {
  if (a.status !== "pending") return { ok: false, error: "This change was already answered.", status: 409 };
  if (expired(a, now)) {
    await supabase.from("price_approvals").update({ status: "expired" }).eq("id", a.id).eq("status", "pending");
    return { ok: false, error: "This change expired and was not applied.", status: 410 };
  }
  // Claimed first, so a double tap never applies it twice.
  const { data: claimed } = await supabase
    .from("price_approvals")
    .update({ status: yes ? "approved" : "declined", decided_at: now.toISOString(), decided_by_name: by.name })
    .eq("id", a.id)
    .eq("status", "pending")
    .select("id");
  if (!claimed || (claimed as unknown[]).length === 0) return { ok: false, error: "This change was already answered.", status: 409 };
  const s = (await getSession(a.session_id)) as EventSession | null;
  if (!s) return { ok: false, error: "We could not find that event.", status: 404 };
  if (!yes) {
    await logActivity(s.id, by, "Price change declined", a.summary);
    await tellAsker(s, a, false);
    return { ok: true, status: "declined" };
  }
  const result = await applyEventUpdate(s.id, a.changes, { requireQuote: true, quotedNewTotal: a.new_total, now }).catch(() => null);
  if (!result || result.needsQuote) {
    await supabase.from("price_approvals").update({ status: "stale" }).eq("id", a.id);
    return { ok: false, error: "The price changed since this was quoted, so nothing was applied. Ask for the change again to get a new quote.", status: 409 };
  }
  await logActivity(s.id, by, "Price change approved", a.summary);
  if (result.rows.length > 0) await deliverEventUpdates(s.id, result.rows).catch(() => []);
  await tellAsker(s, a, true);
  return { ok: true, status: "approved" };
}

async function tellAsker(s: EventSession, a: ApprovalRow, yes: boolean): Promise<void> {
  if (!a.partner_id) return;
  const p = (await partnersByIds([a.partner_id])).get(a.partner_id);
  if (!p?.active) return;
  const key = await ensurePartnerKey(s);
  await sendPartnerText(
    s,
    p.phone,
    p.name,
    yes
      ? `Good news: the change you asked for was approved and is now saved (${a.summary}). See it here: ${siteOrigin()}${partnerEventHref(key ?? "")}`
      : `The change you asked for was not approved, so nothing changed (${a.summary}).`
  );
}
