// Supply costs for one event, from the cost catalog. Server only. Admins only.
// The catalog arrives with the supply costs work; until then there is no
// estimate, and the Business tab says "Supplies not on file".

import type { SessionRow } from "@/lib/event-updates";
import type { StaffMember } from "@/lib/team/event-view";

export interface SupplyCost {
  cents: number;
  matched: { name: string; quantity: number; unitCents: number; cents: number; product: string }[];
  unmatched: string[]; // "we buy" lines with no cost yet
}

export async function supplyCostFor(viewer: StaffMember, session: SessionRow): Promise<SupplyCost | null> {
  void viewer;
  void session;
  return null;
}
