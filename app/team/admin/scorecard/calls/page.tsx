import type { Metadata } from "next";
import { requireScorecard } from "@/lib/team/scorecard-page";
import { callsView, dateWords } from "@/lib/team/scorecard-db";
import { NOT_READY, SCORECARD_PATH } from "@/lib/team/scorecard";
import { chicagoStamp } from "@/lib/team/time";
import TeamHeader from "../../../team-header";
import CallsBoard from "./calls-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Check in calls", robots: { index: false, follow: false } };

// Check in calls: every event in the next 14 days with each assigned person
// (never the viewer). Replaces the call schedule sheet. Admins and managers only.
export default async function CallsPage() {
  const me = await requireScorecard(`${SCORECARD_PATH}/calls`);
  const v = (await callsView(me))!;
  const events = v.events.map((e) => ({
    ...e,
    dayText: dateWords(e.day),
    tuesdayText: dateWords(e.tuesday),
    lock: { ...e.lock, atText: e.lock.at ? chicagoStamp(e.lock.at) : null },
    people: e.people.map((p) => ({ ...p, atText: p.at ? chicagoStamp(p.at) : null })),
  }));
  return (
    <>
      <TeamHeader signedIn admin back={{ href: SCORECARD_PATH, label: "Scorecard" }} />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Check in calls</h1>
          <p className="text-[15px] text-[#6B5D52]">Events in the next 14 days. Calls not done for the coming week and events not locked by the Tuesday before are flagged.</p>
        </div>
        {!v.ready && <p className="rounded-2xl bg-[#FFF8EC] border border-[#E3C9A0] px-4 py-3 text-[15px] text-[#2C2420]">{NOT_READY}</p>}
        <CallsBoard events={events} />
      </main>
    </>
  );
}
