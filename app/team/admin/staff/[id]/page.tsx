import Link from "next/link";
import { requireAdmin } from "@/lib/team/auth";
import { supabase } from "@/lib/supabase";
import { todayFor, upcomingUnavailable } from "@/lib/team/availability-db";
import { rangeLabel } from "@/lib/team/availability";
import { staffMarketsOf, marketLabel } from "@/lib/team/markets";
import TeamHeader from "../../../team-header";
import RecordCard from "../../../record-card";
import { staffRecord } from "@/lib/team/reliability-db";

export const dynamic = "force-dynamic";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";

// One staff member, for admins: availability and the rest of their record.
export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/team/admin/staff/${encodeURIComponent(id)}`);
  const back = { href: "/team/admin/staff", label: "Staff" };
  const { data } = await supabase.from("staff").select("*").eq("id", id).maybeSingle();
  const person = data as { id: string; name: string; role: string; active: boolean; markets?: unknown } | null;
  if (!person) {
    return (
      <>
        <TeamHeader signedIn admin back={back} />
        <main className="max-w-md mx-auto px-4 py-10 text-center text-[15px] text-[#6B5D52]">We could not find that person.</main>
      </>
    );
  }
  const today = await todayFor(id);
  const [away, record] = await Promise.all([upcomingUnavailable(id, today), staffRecord(id)]);
  return (
    <>
      <TeamHeader signedIn admin back={back} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420] break-words">{person.name || "No name yet"}</h1>
          <p className="text-[15px] text-[#6B5D52]">
            {[person.role === "admin" ? "Admin" : "Bartender", staffMarketsOf(person).map((m) => marketLabel(m)).join(", "), person.active ? "" : "Inactive"].filter(Boolean).join(" · ")}
          </p>
          <Link href={`/team/admin/preview/${id}`} className="text-sm text-[#B5845A] underline">
            Preview as
          </Link>
        </div>

        <RecordCard record={record} />

        <section className={card} aria-label="Availability">
          <h2 className="font-heading text-base font-bold text-[#2C2420] mb-2">Availability</h2>
          {away.length === 0 ? (
            <p className="text-[15px] text-[#6B5D52]">No unavailable days coming up.</p>
          ) : (
            <ul className="divide-y divide-[#DDD5CC]">
              {away.map((r) => (
                <li key={r.id} className="py-2">
                  <p className="font-medium text-[#2C2420]">{rangeLabel(r)}</p>
                  {r.note && <p className="text-sm text-[#6B5D52] break-words">{r.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
