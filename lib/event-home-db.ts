// Gathers what the event home (lib/event-home.ts) shows for one viewer: the
// client on their own link, or a planner on their event page. What the viewer
// may see of the money is passed in (the client sees all of it; a planner
// follows moneyAccess, which follows "Planner can see pricing").
//
// Never read here for the page: team notes, staff pay, costs, staff ratings,
// supplier details, payment notes or who recorded a payment, last names, or
// phone numbers of anyone on the team.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { eventData, eventTimeZone } from "@/lib/team/markets";
import { eventSchedule, longDate } from "@/lib/team/time";
import { computeDeadlines, recapLines } from "@/lib/event-diff";
import { eventPayments, financeRow } from "@/lib/team/business-db";
import { recordedFrom } from "@/lib/balance";
import { autoSendOn, holdsFor, listState } from "@/lib/client-list-db";
import { firstName } from "@/lib/team/event-view";
import { typeLabel } from "@/lib/team/approved-menu";
import { AGREEMENT_BUCKET, AGREEMENT_LINK_SECONDS, type AgreementRow } from "@/lib/team/agreements";
import { shortLink } from "@/lib/team/direct-upload";
import { requestsShown } from "@/lib/team-notes";
import { balanceFact, paymentView, REQUEST_STATUS, type HomeMoney, type ListTiming, type PaymentView, type PendingRequest, type TeamMember, type TodoFacts } from "@/lib/event-home";

export interface HomeData {
  date: string; // "Saturday, December 12, 2026"
  daysUntil: number | null;
  past: boolean;
  team: TeamMember[];
  payment: PaymentView | null;
  paymentLines: { amount: string; on: string }[]; // each recorded payment, when the viewer may see payments
  balance: TodoFacts["balance"];
  agreements: { id: string; label: string; typeLabel: string }[];
  listTiming: ListTiming;
  requests: PendingRequest[];
}

const DAY_MS = 86_400_000;
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * The bar team: accepted and not dropped, first names only. The event
 * assignment carries no role, so no role is shown: never "Bartender" for
 * everyone. If assignments ever get a role, it goes in TeamMember.role.
 */
export async function homeTeam(sessionId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase.from("event_assignments").select("staff_id, status, dropped_at").eq("session_id", sessionId).eq("status", "accepted");
  if (error || !data || data.length === 0) return [];
  const ids = (data as { staff_id: string; dropped_at: string | null }[]).filter((a) => !a.dropped_at).map((a) => a.staff_id);
  if (ids.length === 0) return [];
  const { data: staff } = await supabase.from("staff").select("id, name").in("id", ids);
  return ((staff as { name: string }[] | null) ?? []).map((s) => ({ name: firstName(s.name), role: "" })).filter((m) => m.name);
}

/** Current agreements only (never one still uploading, replaced, or removed). */
export async function currentAgreements(sessionId: string): Promise<AgreementRow[]> {
  const { data, error } = await supabase.from("event_agreements").select("*").eq("session_id", sessionId).eq("status", "current");
  return error || !data ? [] : (data as AgreementRow[]);
}

/** A 10 minute signed link to one current agreement, after the caller has checked who is asking. */
export async function agreementLink(sessionId: string, fileId: string, download: boolean): Promise<string | null> {
  const row = (await currentAgreements(sessionId)).find((r) => r.id === fileId);
  if (!row) return null;
  return shortLink(AGREEMENT_BUCKET, row.file_path, AGREEMENT_LINK_SECONDS, download ? row.file_name || "Agreement" : undefined);
}

async function listTiming(sessionId: string): Promise<ListTiming> {
  if (!(await autoSendOn().catch(() => false))) return "later";
  const state = await listState(sessionId).catch(() => null);
  if (!state || state.released) return "ready";
  return "review";
}

/** The client's change requests: waiting, or decided in the last 30 days. Read back from the changes, in the client's words. */
async function requestsFor(s: SessionRow, ed: Record<string, unknown>, now: Date): Promise<PendingRequest[]> {
  const holds = (await holdsFor(s.id).catch(() => [])).filter((h) => h.kind === "change");
  const shown = requestsShown(ed);
  const out: PendingRequest[] = [];
  for (const h of holds) {
    const decided = h.decided_at ? new Date(h.decided_at).getTime() : null;
    if (h.status !== "pending" && (decided === null || now.getTime() - decided > 30 * DAY_MS)) continue;
    // An older event's requests were written for our team: never read them back here.
    const changes = (h.changes ?? []).filter((c) => shown || c.field !== "special_requests");
    const summary = recapLines(changes).join("; ");
    out.push({
      summary: summary || "A change you asked for",
      status: REQUEST_STATUS[h.status],
      when: longDate(String(h.created_at).slice(0, 10)),
    });
  }
  if (s.price_pending) out.push({ summary: "Your latest change", status: REQUEST_STATUS.price, when: "" });
  return out.reverse();
}

export async function eventHome(s: SessionRow, money: HomeMoney, now: Date = new Date()): Promise<HomeData> {
  const ed = eventData(s);
  const day = eventSchedule(ed).day;
  const deadlines = computeDeadlines(ed.event_date ?? s.event_date, now, eventTimeZone(s));
  const past = deadlines.eventPassed;
  const seeMoney = money.total || money.balance;
  const [team, pays, finance, agreements, timing, requests] = await Promise.all([
    homeTeam(s.id),
    seeMoney ? eventPayments(s.id).catch(() => []) : Promise.resolve([]),
    seeMoney ? financeRow(s.id).catch(() => null) : Promise.resolve(null),
    money.agreement ? currentAgreements(s.id).catch(() => []) : Promise.resolve([]),
    listTiming(s.id),
    requestsFor(s, ed, now),
  ]);
  // The booked total only: never computed again here, never the deposit.
  const raw = s.booked_price?.total;
  const total = raw === null || raw === undefined || !Number.isFinite(Number(raw)) ? null : Number(raw);
  // Recorded only: an entered deposit, a legacy balance, and the payments list. Never the assumed deposit.
  const recorded = recordedFrom(finance, pays);
  const payment = paymentView({ money, total, pricePending: !!s.price_pending, eventDay: day ?? deadlines.eventDay, recorded, preference: ed.payment_preference });
  const depositLine = finance?.deposit_paid_cents ? [{ amount: `${dollars(finance.deposit_paid_cents)} deposit`, on: longDate(finance.deposit_paid_on ?? null) }] : [];
  return {
    date: longDate(day ?? deadlines.eventDay),
    daysUntil: deadlines.daysUntil,
    past,
    team,
    payment,
    paymentLines: money.payments && payment?.paid ? [...depositLine, ...pays.map((p) => ({ amount: dollars(p.cents), on: longDate(p.paidOn) }))] : [],
    balance: balanceFact(payment, total, recorded, day ?? deadlines.eventDay),
    agreements: agreements.map((r) => ({ id: r.id, label: r.label || "Agreement", typeLabel: typeLabel(r.file_type) })),
    listTiming: timing,
    requests,
  };
}
