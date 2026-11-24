// Staff Scorecard, the offer order: tiers with a ranked order inside each
// tier, a solo guest number, weddings yes or no, and a short note. Pure, no
// database (lib/team/scorecard-ranks-db.ts reads and writes it).
//
// Admins change it; managers only view it; nobody sees or changes their own
// record. The manual tier always wins: what the reviews suggest is shown next
// to it and never changes it. Staff never see any of this.

import type { Group } from "@/lib/team/offers";

export const OFFERS_PATH = "/team/admin/scorecard/offers";
export const RANK_NOT_READY = "The offer order is not set up yet. Run the ranked offers migration first.";

export const RANK_TIERS = ["top", "core", "developing"] as const;
export type RankTier = (typeof RANK_TIERS)[number];
export const RANK_TIER_LABEL: Record<RankTier, string> = { top: "Top", core: "Core", developing: "Developing" };
export const TIER_GROUP: Record<RankTier, Group> = { top: 0, core: 1, developing: 2 };
export const isRankTier = (v: unknown): v is RankTier => typeof v === "string" && (RANK_TIERS as readonly string[]).includes(v);

export const RANK_NOTE_MAX = 280;
export const SOLO_MAX = 2000;

export interface RankRow {
  staff_id: string;
  tier: RankTier;
  position: number;
  solo_guests: number | null;
  weddings: boolean;
  note: string;
  placed: boolean;
  updated_by?: string | null;
  updated_by_name?: string | null;
  updated_at?: string | null;
}

/** What gets saved in the history: everything an admin can change. */
export const snapshot = (r: Pick<RankRow, "tier" | "position" | "solo_guests" | "weddings" | "note">) => ({
  tier: r.tier,
  position: r.position,
  solo_guests: r.solo_guests,
  weddings: r.weddings,
  note: r.note,
});

/** Solo guests, weddings and the note, checked. A blank solo number means no limit. */
export function validateRankEdit(raw: Record<string, unknown>): { ok: true; value: { solo_guests: number | null; weddings: boolean; note: string } } | { ok: false; error: string } {
  const soloRaw = raw.solo;
  let solo_guests: number | null = null;
  if (soloRaw !== null && soloRaw !== undefined && String(soloRaw).trim() !== "") {
    const n = Number(String(soloRaw).trim());
    if (!Number.isInteger(n) || n < 1 || n > SOLO_MAX) return { ok: false, error: `Solo guests: a whole number from 1 to ${SOLO_MAX}, or blank for no limit.` };
    solo_guests = n;
  }
  if (typeof raw.weddings !== "boolean") return { ok: false, error: "Pick weddings yes or no." };
  const note = String(raw.note ?? "").replace(/\s+/g, " ").trim();
  if (note.length > RANK_NOTE_MAX) return { ok: false, error: `Keep the note under ${RANK_NOTE_MAX} characters.` };
  return { ok: true, value: { solo_guests, weddings: raw.weddings, note } };
}

/** The reviews' tier, as one of the three offer tiers. New (too few reviews) suggests nothing. */
export function suggestedTier(reviewLabel: string | undefined): RankTier | null {
  switch (reviewLabel) {
    case "Ace":
      return "top";
    case "Solid":
      return "core";
    case "Coach":
      return "developing";
    default:
      return null;
  }
}

/** "Rank: Top 2. Reviews suggest: Core." */
export function rankLine(tier: RankTier, place: number, suggested: RankTier | null): string {
  const s = suggested ? RANK_TIER_LABEL[suggested] : "Not enough reviews";
  return `Rank: ${RANK_TIER_LABEL[tier]} ${place}. Reviews suggest: ${s}.`;
}

/** Everyone in offer order: tier, then position, then name. */
export function sortRanks<T extends Pick<RankRow, "tier" | "position"> & { name?: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => TIER_GROUP[a.tier] - TIER_GROUP[b.tier] || a.position - b.position || (a.name ?? "").localeCompare(b.name ?? ""));
}

/** A new hire's position: the bottom of Developing. */
export function bottomOf(rows: Pick<RankRow, "tier" | "position">[], tier: RankTier): number {
  return rows.filter((r) => r.tier === tier).reduce((m, r) => Math.max(m, r.position), 0) + 1;
}

/**
 * Up or down on one person in the list being shown (one market). Inside a
 * tier it swaps with the neighbor shown. Up from the top of a tier moves them
 * to the bottom of the tier above; down from the bottom moves them to the top
 * of the tier below. Returns the rows to write, or null when nothing moves.
 */
export function moveIn(
  shown: Pick<RankRow, "staff_id" | "tier" | "position">[],
  all: Pick<RankRow, "staff_id" | "tier" | "position">[],
  staffId: string,
  dir: "up" | "down"
): { staff_id: string; tier: RankTier; position: number }[] | null {
  const list = sortRanks(shown);
  const i = list.findIndex((r) => r.staff_id === staffId);
  if (i < 0) return null;
  const me = list[i];
  const n = list[dir === "up" ? i - 1 : i + 1];
  if (n && n.tier === me.tier) {
    return [
      { staff_id: me.staff_id, tier: me.tier, position: n.position },
      { staff_id: n.staff_id, tier: n.tier, position: me.position },
    ];
  }
  const t = TIER_GROUP[me.tier] + (dir === "up" ? -1 : 1);
  if (t < 0 || t > 2) return null;
  const tier = RANK_TIERS[t];
  if (dir === "up") return [{ staff_id: me.staff_id, tier, position: bottomOf(all, tier) }];
  const top = all.filter((r) => r.tier === tier).reduce((m, r) => Math.min(m, r.position), Infinity);
  return [{ staff_id: me.staff_id, tier, position: (Number.isFinite(top) ? top : 1) - 1 }];
}
