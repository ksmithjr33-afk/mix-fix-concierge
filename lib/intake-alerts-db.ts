// The concierge's admin texts at submission: drinks that need a follow up, and
// a final save that failed. Server only. Never throws.

import type { SessionRow } from "@/lib/event-updates";
import { alertAdmins } from "@/lib/team/events";
import { sendStaffText } from "@/lib/team/sms";
import { eventSchedule, shortDate } from "@/lib/team/time";
import { eventData } from "@/lib/team/markets";
import { siteOrigin } from "@/lib/team/clock-db";
import { managerHref } from "@/lib/team/manager-tabs";
import { present } from "@/lib/blank";
import { drinksAlertText, saveFailedAlertText, type DrinkCheck } from "@/lib/intake-plan";

/** Text every admin who gets alerts. Returns how many texts went. */
export async function textAdmins(message: string, tag: string): Promise<number> {
  try {
    const admins = await alertAdmins();
    const sent = await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
    const n = sent.filter(Boolean).length;
    if (n === 0) console.error(`[${tag}] no admin text went out: ${message}`);
    return n;
  } catch (err) {
    console.error(`[${tag}] admin text failed:`, err instanceof Error ? err.message : String(err), message);
    return 0;
  }
}

function who(session: Pick<SessionRow, "name" | "event_data"> | null, ed: Record<string, unknown>): string {
  return present(ed.client_name) ?? present(session?.name) ?? "";
}

/** Drinks not finalized, or an extra drink nobody said yes to: one text to the admins. */
export async function alertDrinks(sessionId: string, session: SessionRow | null, saved: Record<string, unknown>, check: DrinkCheck): Promise<number> {
  if (!check.notFinalized && check.unconfirmed.length === 0) return 0;
  const ed = session ? eventData({ ...session, event_data: saved }) : saved;
  const message = drinksAlertText({ client: who(session, saved), date: shortDate(eventSchedule(ed).day), check, link: `${siteOrigin()}${managerHref(sessionId)}` });
  return textAdmins(message, "drinks not finalized");
}

/** The final save failed: the admins hear about it right away, with the session. */
export async function alertSaveFailed(sessionId: string, session: SessionRow | null, data: Record<string, unknown>): Promise<number> {
  console.error(`[FINAL SAVE FAILED] session=${sessionId}: the client was told our team will follow up.`);
  const message = saveFailedAlertText({ client: who(session, data), sessionId, link: `${siteOrigin()}/team/admin` });
  return textAdmins(message, "final save failed");
}
