// Staff Scorecard, the offer order: the database side. Server only.
//
// Admins change tiers, places, solo guests, weddings and notes; managers only
// view; nobody sees or changes their own record (checked here and by the
// database). Every change is saved to staff_rank_history with who and when.
// Staff never see any of this: no staff page, route, text or export imports
// this file. Only lib/team/scorecard-offers-db.ts reads offerOrder().

import { supabase } from "@/lib/supabase";
import type { StaffMember } from "@/lib/team/event-view";
import { canScore, tierBadges } from "@/lib/team/scorecard-db";
import { marketLabel, MARKETS, staffMarketsOf, type Market } from "@/lib/team/markets";
import { isFullAdmin } from "@/lib/team/roles";
import { includedInOffers, WEEKDAY_NAMES, cleanWeekdays, type Group, type Mode, type Ranked, type Reviewed } from "@/lib/team/offers";
import { offerSettings } from "@/lib/team/offers-db";
import { approvedEventCounts } from "@/lib/team/pay-db";
import { packageRates } from "@/lib/team/business-settings-db";
import { isNewHire, isSupportRole, NOT_PLACED_WARNING, SERVICE_FEE_RATE_DEFAULTS } from "@/lib/team/pay";
import {
  RANK_TIER_LABEL,
  RANK_TIERS,
  TIER_GROUP,
  bottomOf,
  isRankTier,
  moveIn,
  rankLine,
  snapshot,
  sortRanks,
  suggestedTier,
  validateRankEdit,
  type RankRow,
  type RankTier,
} from "@/lib/team/scorecard-ranks";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };
const fail = (error: string, status = 409) => ({ ok: false as const, error, status });
const FORBIDDEN = fail("Admins only.", 403);
const SELF = fail("You cannot see or change your own record.", 403);

export const canViewRanks = (v: Pick<StaffMember, "role"> | null | undefined) => canScore(v);
export const canEditRanks = (v: Pick<StaffMember, "role"> | null | undefined) => !!v && isFullAdmin(v.role);

interface Person {
  id: string;
  name: string;
  phone: string;
  role: string;
  active: boolean;
  markets?: unknown;
  in_offers?: boolean | null;
  off_weekdays?: unknown;
}

async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<{ ok: boolean; rows: T[] }> {
  try {
    const { data, error } = await q;
    if (error) return { ok: false, rows: [] };
    return { ok: true, rows: ((data as T[]) ?? []) as T[] };
  } catch {
    return { ok: false, rows: [] };
  }
}

async function activeStaff(): Promise<Person[]> {
  return (await rows<Person>(supabase.from("staff").select("*").eq("active", true))).rows;
}

/** Everyone in bartender offers: bartenders, and admins and managers switched on. */
export async function includedPeople(): Promise<Person[]> {
  return (await activeStaff()).filter((p) => includedInOffers(p));
}

/**
 * Every included person's rank row. Anyone without one (a new hire, or an
 * admin just switched on) is added at the bottom of Developing with weddings
 * No and "Not placed yet". ready is false before the migration.
 */
export async function ensureRanks(people: Person[]): Promise<{ ready: boolean; ranks: Map<string, RankRow> }> {
  const r = await rows<RankRow>(supabase.from("staff_rank").select("*"));
  if (!r.ok) return { ready: false, ranks: new Map() };
  const ranks = new Map(r.rows.map((x) => [x.staff_id, x]));
  const all = [...r.rows];
  const missing = people.filter((p) => !ranks.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  for (const p of missing) {
    const row: RankRow = { staff_id: p.id, tier: "developing", position: bottomOf(all, "developing"), solo_guests: null, weddings: false, note: "", placed: false };
    const { error } = await supabase.from("staff_rank").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "staff_id", ignoreDuplicates: true });
    if (error) continue;
    ranks.set(p.id, row);
    all.push(row);
  }
  return { ready: true, ranks };
}

async function history(staffId: string, by: StaffMember, before: RankRow | null, after: RankRow, now: Date): Promise<void> {
  const { error } = await supabase.from("staff_rank_history").insert({
    staff_id: staffId,
    changed_by: by.id,
    changed_by_name: by.name,
    changed_at: now.toISOString(),
    before: before ? snapshot(before) : null,
    after: snapshot(after),
  });
  if (error) throw new Error(`rank history failed: ${error.message}`);
}

/** Save one person's row and its history line. */
async function writeRank(by: StaffMember, before: RankRow, patch: Partial<RankRow>, now: Date): Promise<RankRow> {
  const after: RankRow = { ...before, ...patch, placed: true, updated_by: by.id, updated_by_name: by.name, updated_at: now.toISOString() };
  const { error } = await supabase
    .from("staff_rank")
    .update({ tier: after.tier, position: after.position, solo_guests: after.solo_guests, weddings: after.weddings, note: after.note, placed: true, updated_by: by.id, updated_by_name: by.name, updated_at: after.updated_at })
    .eq("staff_id", before.staff_id);
  if (error) throw new Error(`rank save failed: ${error.message}`);
  await history(before.staff_id, by, before, after, now);
  return after;
}

/** Admins only, never about themselves, and only someone in offers. */
async function editable(viewer: StaffMember, staffId: unknown): Promise<Result<{ row: RankRow; all: RankRow[]; people: Person[] }>> {
  if (!canEditRanks(viewer)) return FORBIDDEN;
  if (typeof staffId !== "string" || !staffId) return fail("Pick a person.", 400);
  if (staffId === viewer.id) return SELF;
  const people = await includedPeople();
  const { ready, ranks } = await ensureRanks(people);
  if (!ready) return fail("The offer order is not set up yet. Run the ranked offers migration first.", 503);
  const row = ranks.get(staffId);
  if (!row || !people.some((p) => p.id === staffId)) return fail("That person is not in bartender offers.", 404);
  return { ok: true, row, all: [...ranks.values()], people };
}

// ----- The board -----

export interface BoardPerson {
  staffId: string;
  name: string;
  roleNote: string; // "Admin" or "Manager" for someone switched on, else ""
  tier: RankTier;
  place: number; // inside the tier, in this market's list
  solo: number | null;
  weddings: boolean;
  note: string;
  placed: boolean;
  payWarning: string; // NOT_PLACED_WARNING when they are past the new hire count and not placed, else ""
  suggested: string; // the reviews' tier, "" when there are not enough reviews
  line: string; // "Rank: Top 2. Reviews suggest: Core."
  daysOff: string; // "Never Sundays", for context
  updated: string; // "Changed by Kenneth Smith, Dec 1"
}

export interface BoardMarket {
  market: Market;
  label: string;
  mode: Mode;
  reviewed: Reviewed | null;
  tiers: { tier: RankTier; label: string; people: BoardPerson[] }[];
}

export interface Board {
  ready: boolean;
  canEdit: boolean;
  settings: Awaited<ReturnType<typeof offerSettings>>;
  markets: BoardMarket[];
  optional: { staffId: string; name: string; role: string; on: boolean }[]; // admins and managers who could be switched on
}

const shortWhen = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" }) : "";

/**
 * Of these people who are not placed in a tier, the ones a service fee event
 * pays at the Core rate: bartenders (not support roles) past the new hire count.
 */
async function paidAtCoreUnplaced(people: { id: string; role?: string | null }[]): Promise<Set<string>> {
  const bartenders = people.filter((p) => !isSupportRole(p.role));
  if (bartenders.length === 0) return new Set();
  const [counts, rates] = await Promise.all([approvedEventCounts(bartenders.map((p) => p.id)), packageRates()]);
  const sf = rates.serviceFee ?? SERVICE_FEE_RATE_DEFAULTS;
  return new Set(bartenders.filter((p) => !isNewHire(sf, counts.get(p.id) ?? 0)).map((p) => p.id));
}

/** For the Scorecard: everyone included in offers, not placed in a tier, and paid at the Core rate. Never the viewer. Admins and managers only. */
export async function unplacedAtCore(viewer: StaffMember): Promise<{ staffId: string; name: string }[]> {
  if (!canViewRanks(viewer)) return [];
  const people = (await activeStaff()).filter((p) => includedInOffers(p) && p.id !== viewer.id);
  const { ready, ranks } = await ensureRanks(people);
  if (!ready) return [];
  const paid = await paidAtCoreUnplaced(people.filter((p) => !ranks.get(p.id)?.placed));
  return people.filter((p) => paid.has(p.id)).map((p) => ({ staffId: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The offer order for each market. Never the viewer's own row. Null for anyone but admins and managers. */
export async function rankBoard(viewer: StaffMember): Promise<Board | null> {
  if (!canViewRanks(viewer)) return null;
  const staff = await activeStaff();
  const people = staff.filter((p) => includedInOffers(p));
  const [{ ready, ranks }, settings] = await Promise.all([ensureRanks(people), offerSettings()]);
  const shown = people.filter((p) => p.id !== viewer.id);
  const [badges, unplacedPaid] = await Promise.all([tierBadges(viewer, shown.map((p) => p.id)), paidAtCoreUnplaced(shown.filter((p) => !ranks.get(p.id)?.placed))]);
  const markets: BoardMarket[] = MARKETS.map((m) => {
    const inMarket = sortRanks(
      shown.filter((p) => staffMarketsOf(p).includes(m) && ranks.has(p.id)).map((p) => ({ ...ranks.get(p.id)!, name: p.name, person: p }))
    );
    return {
      market: m,
      label: marketLabel(m),
      mode: settings.modes[m],
      reviewed: settings.reviewed[m] ?? null,
      tiers: RANK_TIERS.map((tier) => ({
        tier,
        label: RANK_TIER_LABEL[tier],
        people: inMarket
          .filter((r) => r.tier === tier)
          .map((r, i) => {
            const sug = suggestedTier(badges[r.staff_id]);
            const off = cleanWeekdays(r.person.off_weekdays) ?? [];
            return {
              staffId: r.staff_id,
              name: r.name,
              roleNote: r.person.role === "admin" ? "Admin" : r.person.role === "manager" ? "Manager" : "",
              tier,
              place: i + 1,
              solo: r.solo_guests,
              weddings: r.weddings,
              note: r.note,
              placed: r.placed,
              payWarning: unplacedPaid.has(r.staff_id) ? NOT_PLACED_WARNING : "",
              suggested: sug ? RANK_TIER_LABEL[sug] : "",
              line: rankLine(tier, i + 1, sug),
              daysOff: off.length ? `Never ${off.map((d) => WEEKDAY_NAMES[d]).join(", ")}` : "",
              updated: r.updated_by_name ? `Changed by ${r.updated_by_name}, ${shortWhen(r.updated_at)}` : "",
            };
          }),
      })),
    };
  });
  const optional = staff
    .filter((p) => (p.role === "admin" || p.role === "manager") && p.id !== viewer.id)
    .map((p) => ({ staffId: p.id, name: p.name, role: p.role === "admin" ? "Admin" : "Manager", on: p.in_offers === true }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ready, canEdit: canEditRanks(viewer), settings, markets, optional };
}

// ----- Changes -----

/** Up or down in a market's list. Past the end of a tier, into the next tier. */
export async function moveRank(viewer: StaffMember, body: Record<string, unknown>, now: Date = new Date()): Promise<Result> {
  const e = await editable(viewer, body.staffId);
  if (!e.ok) return e;
  if (body.dir !== "up" && body.dir !== "down") return fail("Bad request", 400);
  const market = typeof body.market === "string" && (MARKETS as readonly string[]).includes(body.market) ? (body.market as Market) : null;
  // Moves happen in the list shown: one market, never the viewer.
  const shownIds = new Set(e.people.filter((p) => p.id !== viewer.id && (!market || staffMarketsOf(p).includes(market))).map((p) => p.id));
  const shown = e.all.filter((r) => shownIds.has(r.staff_id));
  const moves = moveIn(shown, e.all, e.row.staff_id, body.dir);
  if (!moves) return fail(body.dir === "up" ? "Already at the top." : "Already at the bottom.");
  const byId = new Map(e.all.map((r) => [r.staff_id, r]));
  for (const m of moves) {
    if (m.staff_id === viewer.id) return SELF;
    await writeRank(viewer, byId.get(m.staff_id)!, { tier: m.tier, position: m.position }, now);
  }
  return { ok: true };
}

/** Move someone to another tier: they go to the bottom of it. */
export async function setTier(viewer: StaffMember, body: Record<string, unknown>, now: Date = new Date()): Promise<Result> {
  const e = await editable(viewer, body.staffId);
  if (!e.ok) return e;
  if (!isRankTier(body.tier)) return fail("Pick Top, Core or Developing.", 400);
  if (body.tier === e.row.tier) {
    await writeRank(viewer, e.row, {}, now); // "placed" without moving
    return { ok: true };
  }
  await writeRank(viewer, e.row, { tier: body.tier, position: bottomOf(e.all, body.tier) }, now);
  return { ok: true };
}

/** Solo guests, weddings and the note. */
export async function editRank(viewer: StaffMember, body: Record<string, unknown>, now: Date = new Date()): Promise<Result> {
  const e = await editable(viewer, body.staffId);
  if (!e.ok) return e;
  const v = validateRankEdit(body);
  if (!v.ok) return fail(v.error, 400);
  await writeRank(viewer, e.row, v.value, now);
  return { ok: true };
}

/** "Include in bartender offers" for an admin or manager who also bartends. Admins only, never themselves. */
export async function setIncluded(viewer: StaffMember, body: Record<string, unknown>): Promise<Result> {
  if (!canEditRanks(viewer)) return FORBIDDEN;
  const id = body.staffId;
  if (typeof id !== "string" || !id) return fail("Pick a person.", 400);
  if (id === viewer.id) return SELF;
  if (typeof body.on !== "boolean") return fail("Bad request", 400);
  const p = (await activeStaff()).find((x) => x.id === id);
  if (!p || (p.role !== "admin" && p.role !== "manager")) return fail("Only admins and managers are switched on here. Bartenders are always in offers.", 400);
  const { error } = await supabase.from("staff").update({ in_offers: body.on }).eq("id", id);
  if (error) return fail(/in_offers/.test(error.message) ? "Run the ranked offers migration first." : "Could not save. Try again.", 500);
  if (body.on) await ensureRanks([{ ...p, in_offers: true }]);
  return { ok: true };
}

export interface HistoryLine {
  at: string;
  by: string;
  what: string;
}

const describe = (b: Record<string, unknown> | null, a: Record<string, unknown>): string => {
  if (!b) return `Added: ${RANK_TIER_LABEL[a.tier as RankTier] ?? a.tier}`;
  const parts: string[] = [];
  if (b.tier !== a.tier) parts.push(`${RANK_TIER_LABEL[b.tier as RankTier]} to ${RANK_TIER_LABEL[a.tier as RankTier]}`);
  else if (b.position !== a.position) parts.push(Number(a.position) < Number(b.position) ? "Moved up" : "Moved down");
  if (b.solo_guests !== a.solo_guests) parts.push(`Solo guests ${a.solo_guests ?? "no limit"}`);
  if (b.weddings !== a.weddings) parts.push(`Weddings ${a.weddings ? "yes" : "no"}`);
  if (b.note !== a.note) parts.push("Note changed");
  return parts.join(", ") || "Placed";
};

/** Who changed this person's tier, place or details, and when, newest first. Never your own. */
export async function rankHistory(viewer: StaffMember, staffId: string): Promise<Result<{ lines: HistoryLine[] }>> {
  if (!canViewRanks(viewer)) return FORBIDDEN;
  if (staffId === viewer.id) return SELF;
  const r = await rows<{ changed_at: string; changed_by_name: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> }>(
    supabase.from("staff_rank_history").select("*").eq("staff_id", staffId)
  );
  const lines = r.rows
    .sort((a, b) => b.changed_at.localeCompare(a.changed_at))
    .slice(0, 50)
    .map((h) => ({ at: shortWhen(h.changed_at), by: h.changed_by_name ?? "", what: describe(h.before, h.after) }));
  return { ok: true, lines };
}

// ----- For the offer runner only -----

/** The people in offers for a market, in offer order, with their rank rows. Server only: never shown to staff. */
export async function offerOrder(market: Market): Promise<{ ready: boolean; people: (Person & { rank: RankRow })[]; order: Ranked[] }> {
  const people = (await includedPeople()).filter((p) => staffMarketsOf(p).includes(market));
  const { ready, ranks } = await ensureRanks(people);
  const sorted = sortRanks(people.filter((p) => ranks.has(p.id)).map((p) => ({ ...ranks.get(p.id)!, name: p.name, person: p })));
  const place: Record<RankTier, number> = { top: 0, core: 0, developing: 0 };
  const order: Ranked[] = sorted.map((r) => ({ staffId: r.staff_id, grp: TIER_GROUP[r.tier] as Group, rank: ++place[r.tier] }));
  return { ready, people: sorted.map((r) => ({ ...r.person, rank: ranks.get(r.staff_id)! })), order };
}

/** True when someone on the event is outside Developing (or not ranked at all, such as an admin who was assigned). */
export async function anyoneBeyondDeveloping(staffIds: string[]): Promise<boolean> {
  if (staffIds.length === 0) return false;
  const r = await rows<RankRow>(supabase.from("staff_rank").select("*").in("staff_id", staffIds));
  const byId = new Map(r.rows.map((x) => [x.staff_id, x]));
  return staffIds.some((id) => byId.get(id)?.tier !== "developing");
}

