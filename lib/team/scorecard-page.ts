// The Scorecard pages' gate: signed in and named (requireStaff), then admins and
// managers only, else a 403. Server only.

import { forbidden } from "next/navigation";
import { requireStaff } from "@/lib/team/auth";
import { canScore } from "@/lib/team/scorecard-db";

export async function requireScorecard(path: string) {
  const staff = await requireStaff(path);
  if (!canScore(staff)) forbidden();
  return staff;
}
