import { requireStaff } from "@/lib/team/auth";
import { openAnnouncement } from "@/lib/team/announcements-db";
import { audienceLabel } from "@/lib/team/announcements";
import { marketLabel } from "@/lib/team/markets";
import TeamHeader from "../../team-header";

export const dynamic = "force-dynamic";

function at(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(/[  ]/g, " ");
}

// One announcement. Opening it marks it read. Admins see who has opened it.
export default async function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff(`/team/announcements/${encodeURIComponent(id)}`);
  const admin = staff.role === "admin";
  const back = { href: "/team/announcements", label: "Announcements" };
  const detail = await openAnnouncement(id, staff);
  if (!detail) {
    return (
      <>
        <TeamHeader signedIn admin={admin} back={back} />
        <main className="max-w-md mx-auto px-4 py-10 text-center">
          <p className="text-[15px] text-[#6B5D52]">We could not find that announcement.</p>
        </main>
      </>
    );
  }
  const { item, opens } = detail;
  const opened = opens?.filter((o) => o.openedAt) ?? [];
  const waiting = opens?.filter((o) => !o.openedAt) ?? [];
  return (
    <>
      <TeamHeader signedIn admin={admin} back={back} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <article className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4 space-y-2">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420] break-words">{item.title}</h1>
          <p className="text-xs text-[#A39585]">
            {at(item.createdAt)}
            {admin && ` · ${audienceLabel(item.audience, (m) => marketLabel(m as never))}`}
          </p>
          <p className="text-[15px] text-[#2C2420] whitespace-pre-wrap break-words">{item.body}</p>
        </article>
        {opens && (
          <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4 space-y-3">
            <h2 className="font-heading text-lg font-bold text-[#2C2420]">
              Opened by {opened.length} of {opens.length}
            </h2>
            {opened.length > 0 && (
              <ul className="space-y-1">
                {opened.map((o, i) => (
                  <li key={`o${i}`} className="text-sm text-[#2C2420]">
                    {o.name} <span className="text-[#A39585]">· opened {at(o.openedAt!)}</span>
                  </li>
                ))}
              </ul>
            )}
            {waiting.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#B5845A]">Not opened yet</h3>
                <ul className="space-y-1 mt-1">
                  {waiting.map((o, i) => (
                    <li key={`w${i}`} className="text-sm text-[#6B5D52]">
                      {o.name} <span className="text-[#A39585]">· {o.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
