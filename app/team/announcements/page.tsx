import Link from "next/link";
import { requireStaff } from "@/lib/team/auth";
import { announcementsFor } from "@/lib/team/announcements-db";
import { audienceLabel } from "@/lib/team/announcements";
import { marketLabel, MARKETS, MARKET_INFO } from "@/lib/team/markets";
import TeamHeader from "../team-header";
import Compose from "./compose";
import { giphyEnabled } from "@/lib/team/media";

export const dynamic = "force-dynamic";

function sentOn(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(/[  ]/g, " ");
}

// Everyone reads the announcements sent to them here, unread ones marked.
// Admins also write new ones and see how many people opened each.
export default async function AnnouncementsPage() {
  const staff = await requireStaff("/team/announcements");
  const admin = staff.role === "admin";
  const items = await announcementsFor(staff);
  const unread = items.filter((i) => i.unread).length;
  return (
    <>
      <TeamHeader signedIn admin={admin} back={{ href: "/team/events", label: "Events" }} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Announcements</h1>
          <p className="text-[15px] text-[#6B5D52]">{unread ? `${unread} unread` : "You are all caught up."}</p>
        </div>
        {admin && <Compose markets={MARKETS.map((m) => ({ id: m, label: MARKET_INFO[m].label }))} gifSearch={giphyEnabled()} />}
        {items.length === 0 ? (
          <p className="text-[15px] text-[#6B5D52] bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4">No announcements yet.</p>
        ) : (
          <ul className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] divide-y divide-[#DDD5CC] overflow-hidden">
            {items.map((a) => (
              <li key={a.id}>
                <Link href={`/team/announcements/${a.id}`} className="block px-4 py-3 hover:bg-[#EFE7DF] transition-colors">
                  <span className="flex items-center gap-2">
                    {a.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-[#A0412D]" aria-hidden />}
                    <span className={`min-w-0 truncate font-heading text-[#2C2420] ${a.unread ? "font-bold" : "font-medium"}`}>{a.title}</span>
                    {a.unread && <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F6E3DC] text-[#A0412D]">New</span>}
                  </span>
                  <span className="block text-sm text-[#6B5D52] truncate">{a.body}</span>
                  <span className="block text-xs text-[#A39585]">
                    {sentOn(a.createdAt)}
                    {admin && ` · ${audienceLabel(a.audience, (m) => marketLabel(m as never))} · opened by ${a.opened ?? 0} of ${a.recipients ?? 0}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
