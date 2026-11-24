import Link from "next/link";
import { requireAdmin } from "@/lib/team/auth";
import { supabase } from "@/lib/supabase";
import { chicagoToday } from "@/lib/team/time";
import { upcomingMocktails } from "@/lib/team/mocktail-review";
import TeamHeader from "../../team-header";

export const dynamic = "force-dynamic";

// Admins and managers: upcoming events that already have a mocktail on the menu.
// Read only. Mocktails saved before the server check are listed with their
// ingredients so the team can review them; nothing here changes an event.
export default async function MocktailReviewPage() {
  await requireAdmin("/team/admin/mocktails");
  const { data } = await supabase.from("sessions").select("id, status, event_date, event_data").eq("status", "submitted");
  const rows = upcomingMocktails((data as Parameters<typeof upcomingMocktails>[0]) ?? [], chicagoToday());
  return (
    <>
      <TeamHeader signedIn admin back={{ href: "/team/admin/staff", label: "Staff" }} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Upcoming events with a mocktail</h1>
          <p className="text-[15px] text-[#6B5D52]">
            Read only. There is no mocktail menu yet, so these were either saved before the concierge stopped building mocktails, or are waiting for our team to send options.
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-4 text-[15px] text-[#6B5D52]">No upcoming event has a mocktail.</p>
        ) : (
          <ul className="rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] divide-y divide-[#DDD5CC] overflow-hidden">
            {rows.map((r) => (
              <li key={r.sessionId} className="px-4 py-3 space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <Link href={`/team/admin/e/${encodeURIComponent(r.sessionId)}`} className="font-heading font-bold text-[#2C2420] underline decoration-[#DDD5CC] break-words">
                    {r.title || "Event"}
                  </Link>
                  <span className="text-sm text-[#6B5D52]">{[r.date, r.package].filter(Boolean).join(" · ")}</span>
                </div>
                <ul className="text-[15px] text-[#2C2420]">
                  {r.mocktails.map((m, i) => (
                    <li key={i}>
                      {m.followup ? (
                        <span>
                          {m.name} <span className="text-sm text-[#9A7049]">· waiting for our team to send options</span>
                        </span>
                      ) : (
                        <span>
                          {m.name}
                          <span className="block text-sm text-[#6B5D52]">{m.ingredients.length ? m.ingredients.join(", ") : "No ingredients on file"}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
