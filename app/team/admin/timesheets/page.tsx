import Link from "next/link";
import { requireAdmin } from "@/lib/team/auth";
import { timesheetRows } from "@/lib/team/timesheet-db";
import { isYmd, staffTotals, weekLabel, weekRange } from "@/lib/team/timesheet";
import { overWeekLimit } from "@/lib/team/payout";
import { chicagoToday } from "@/lib/team/time";
import TeamHeader from "../../team-header";
import TimesheetWeek from "./timesheet-week";
import { payRates } from "@/lib/team/pay-db";
import { payoutFrom } from "@/lib/team/payout-db";
import { getSubmittedSession } from "@/lib/team/events";
import PayoutCard from "../payout-card";

export const dynamic = "force-dynamic";

// One row per staff member per event, for events in the week (Monday to Sunday).
export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const asked = typeof params.week === "string" && isYmd(params.week) ? params.week : chicagoToday();
  const week = weekRange(asked);
  const me = await requireAdmin(`/team/admin/timesheets?week=${week.from}${typeof params.event === "string" ? `&event=${encodeURIComponent(params.event)}` : ""}`);
  const eventId = typeof params.event === "string" && params.event ? params.event : null;
  const all = await timesheetRows(week.from, week.to);
  // From the manager view's Time clock card: just that event, with the same rows the week shows.
  const rows = eventId ? all.filter((r) => r.sessionId === eventId) : all;
  const [rates, session] = await Promise.all([Object.fromEntries(await payRates(me, rows.map((r) => r.staffId))), eventId ? getSubmittedSession(eventId) : null]);
  // The Payout card for one event, from the same rows. Admins and managers.
  const payout = session ? await payoutFrom(me, session, rows) : null;

  return (
    <>
      <TeamHeader signedIn admin />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Timesheets</h1>
          <div className="flex items-center justify-between gap-2 mt-1">
            <Link href={`/team/admin/timesheets?week=${week.prev}`} className="text-sm text-[#B5845A] underline" aria-label="Previous week">
              Previous
            </Link>
            <p className="text-[15px] font-medium text-[#2C2420] text-center">{weekLabel(week.from, week.to)}</p>
            <Link href={`/team/admin/timesheets?week=${week.next}`} className="text-sm text-[#B5845A] underline" aria-label="Next week">
              Next
            </Link>
          </div>
        </div>
        {eventId && (
          <p className="px-1 text-[15px] text-[#2C2420]">
            Showing {rows[0]?.eventTitle ? <span className="font-medium">{rows[0].eventTitle}</span> : "one event"} only.{" "}
            <Link href={`/team/admin/timesheets?week=${week.from}`} className="text-[#B5845A] underline">
              Show the whole week
            </Link>
          </p>
        )}
        {payout && session && <PayoutCard sessionId={session.id} title={[rows[0]?.eventTitle, rows[0]?.eventDay].filter(Boolean).join(", ") || "Payout"} rows={payout.rows} totals={payout.totals} />}
        <TimesheetWeek key={`${week.from}:${eventId ?? ""}`} initial={rows} meId={me.id} from={week.from} to={week.to} rates={rates} scope={eventId ? "event" : "week"} over40={[...overWeekLimit(staffTotals(all))]} />
      </main>
    </>
  );
}
