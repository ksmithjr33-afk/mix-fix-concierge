// The tier each bartender had over time, for service fee pay only. Server
// only. The tier tables are read here and in the Scorecard, nowhere else; pay
// code (lib/team/pay-db.ts payStandings) gets back only the tier rows it needs
// to figure a rate, and the tier never reaches a staff page (forStaff).

import { supabase } from "@/lib/supabase";

export interface TierNow {
  staff_id: string;
  tier: string;
  placed: boolean;
}

export interface TierChange {
  staff_id: string;
  changed_at: string;
  after: { tier?: string } | null;
}

/** Current tier rows and every tier change for these people. Empty when the tables are not there yet. */
export async function tiersForPay(staffIds: string[]): Promise<{ now: TierNow[]; changes: TierChange[] }> {
  const ids = [...new Set(staffIds)];
  if (ids.length === 0) return { now: [], changes: [] };
  const [rankRes, histRes] = await Promise.all([
    supabase.from("staff_rank").select("staff_id, tier, placed").in("staff_id", ids),
    supabase.from("staff_rank_history").select("staff_id, changed_at, after").in("staff_id", ids),
  ]);
  return { now: (rankRes.data as TierNow[]) ?? [], changes: (histRes.data as TierChange[]) ?? [] };
}
