import CopyButton from "../../copy-button";
import { PLANNING_TAG } from "@/lib/planning-text";

// The Planning card on Details for a booking the client has not finished
// planning (lib/planning.ts): their planning link with Copy and Open, when they
// booked and how many days ago, and whether they have started the concierge.
// Admins and managers only (the page is behind requireAdmin).

export interface PlanningCardData {
  conciergeUrl: string;
  openConcierge: string;
  bookedOn: string; // "November 20, 2026", or ""
  daysSince: number | null;
  started: boolean;
  lastOpened: string; // "Nov 24, 3:10 PM", or ""
}

export default function PlanningCard({ data }: { data: PlanningCardData }) {
  const ago = data.daysSince === null ? "" : data.daysSince === 0 ? "today" : `${data.daysSince} day${data.daysSince === 1 ? "" : "s"} ago`;
  return (
    <section className="rounded-2xl border-2 border-[#E0B04A] bg-[#FFF8EC] px-4 py-3 sm:px-5 sm:py-4 space-y-3" data-planning-card>
      <h2 className="font-heading text-base font-bold text-[#8A5A12]">Planning: {PLANNING_TAG.toLowerCase()}</h2>
      <p className="text-sm text-[#2C2420]">
        The client has not finished the concierge. What the booking gave us is below. The Shopping list, client list, supplies, recipes and menu open once they finish.
      </p>
      <div className="space-y-1">
        <p className="text-xs text-[#A39585] uppercase tracking-wide">Planning link</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg bg-white border border-[#DDD5CC] px-3 py-2 text-sm text-[#2C2420]">{data.conciergeUrl}</code>
          <CopyButton text={data.conciergeUrl} />
          <a href={data.openConcierge} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg border-2 border-[#B5845A] text-[#9A7049] px-3 py-1.5 text-sm font-medium">
            Open
          </a>
        </div>
      </div>
      <ul className="text-sm text-[#2C2420] space-y-0.5">
        <li>
          Booked: {data.bookedOn || "not known"}
          {ago ? ` (${ago})` : ""}
        </li>
        <li>Concierge: {data.started ? "started, not finished" : "not started"}</li>
        <li>{data.lastOpened ? `Last opened their link ${data.lastOpened}` : "Has not opened their link yet"}</li>
      </ul>
      <p className="text-xs text-[#A39585]">Open from here does not count as the client opening it. Nothing is sent to the client from this card.</p>
    </section>
  );
}
