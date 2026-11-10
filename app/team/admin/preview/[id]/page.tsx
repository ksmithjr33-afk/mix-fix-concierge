import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/team/auth";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { upcomingSections } from "@/lib/team/event-list";
import { assignedEventItems } from "@/lib/team/my-events";
import { openShiftsFor } from "@/lib/team/shifts-db";
import { marketLabel, staffMarketsOf } from "@/lib/team/markets";
import { chicagoToday } from "@/lib/team/time";
import TeamHeader from "../../../team-header";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { offered: "Offered, not answered yet", accepted: "Accepted" };

// "Preview as": what one staff member sees, read only. Nothing here acts as
// them: no links into their event pages, and no accept, request, clock in, or
// checkbox controls.
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/team/admin/preview/${encodeURIComponent(id)}`);
  const back = { href: "/team/admin/staff", label: "Staff" };
  const { data } = await supabase.from("staff").select("*").eq("id", id).maybeSingle();
  const person = data as (StaffMember & { markets?: unknown }) | null;
  if (!person) {
    return (
      <>
        <TeamHeader signedIn admin back={back} />
        <main className="max-w-md mx-auto px-4 py-10 text-center">
          <p className="text-[15px] text-[#6B5D52]">We could not find that person.</p>
        </main>
      </>
    );
  }
  const today = chicagoToday();
  // As a bartender sees it: their own events, and open shifts in their markets.
  const [events, shifts] = await Promise.all([assignedEventItems(person.id), person.active ? openShiftsFor({ ...person, role: "bartender" }) : Promise.resolve([])]);
  const sections = upcomingSections(events, today);
  const name = firstName(person.name) || "This person";
  return (
    <>
      <TeamHeader signedIn admin back={back} />
      <div className="px-3 sm:px-4 py-2 bg-[#2C2420] text-white text-sm">
        <span className="font-bold">Preview as {person.name}.</span> <span className="text-white/80">Read only. You cannot act for them here.</span>
      </div>
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">What {name} sees</h1>
          <p className="text-[15px] text-[#6B5D52]">
            Markets: {staffMarketsOf(person).map((m) => marketLabel(m)).join(", ")}
            {!person.active && " · Inactive, so they cannot sign in"}
          </p>
        </div>

        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#B5845A] px-1">Their upcoming events</h2>
          {sections.length === 0 ? (
            <p className="text-[15px] text-[#6B5D52] bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4">No upcoming events.</p>
          ) : (
            sections.map((s) => (
              <div key={s.name} className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#A39585] px-1">{s.name}</h3>
                {s.days.map((d) => (
                  <div key={d.day ?? "tbd"}>
                    <h4 className="font-heading text-[15px] font-bold text-[#2C2420] px-1 pb-1">{d.label}</h4>
                    <ul className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] divide-y divide-[#DDD5CC] overflow-hidden">
                      {d.events.map((e) => (
                        <li key={e.id} className="flex items-start gap-3 px-3 py-2.5">
                          <span className="w-[4.5rem] shrink-0 pt-0.5 text-sm font-medium text-[#2C2420] tabular-nums">{e.arrival || "TBD"}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-heading font-bold text-[#2C2420]">{e.title}</span>
                            <span className="block text-sm text-[#6B5D52] break-words">{e.detail}</span>
                            {e.status && <span className="block text-xs text-[#9A7049]">{STATUS[e.status] ?? e.status}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#B5845A] px-1">Open shifts they can see</h2>
          {shifts.length === 0 ? (
            <p className="text-[15px] text-[#6B5D52] bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4">No open shifts in their markets right now.</p>
          ) : (
            <ul className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] divide-y divide-[#DDD5CC] overflow-hidden">
              {shifts.map(({ shift, myRequest, sameDay }) => (
                <li key={shift.postId} className="flex items-start gap-3 px-3 py-2.5">
                  <span className="w-[4.5rem] shrink-0 pt-0.5 text-sm font-medium text-[#2C2420] tabular-nums">{shift.arrival || "TBD"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-heading font-bold text-[#2C2420]">{shift.shortDate}</span>
                      {shift.cover && <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F6E3DC] text-[#A0412D]">Cover needed</span>}
                      {myRequest === "requested" && <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#E4EBDF] text-[#55684A]">Requested</span>}
                    </span>
                    <span className="block text-sm text-[#6B5D52] break-words">
                      {[shift.eventType, shift.city, shift.guestCount ? `${shift.guestCount} guests` : "", shift.package].filter(Boolean).join(" · ")}
                    </span>
                    {sameDay.length > 0 && <span className="block text-xs text-[#9A7049]">They have another event that day</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
