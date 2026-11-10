import Link from "next/link";
import { requireAdmin } from "@/lib/team/auth";
import { timesheetRows } from "@/lib/team/timesheet-db";
import { isYmd, weekLabel, weekRange } from "@/lib/team/timesheet";
import { chicagoToday } from "@/lib/team/time";
import TeamHeader from "../../team-header";
import TimesheetWeek from "./timesheet-week";

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
  const me = await requireAdmin(`/team/admin/timesheets?week=${week.from}`);
  const rows = await timesheetRows(week.from, week.to);

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
        <TimesheetWeek key={week.from} initial={rows} meId={me.id} from={week.from} to={week.to} />
      </main>
    </>
  );
}
