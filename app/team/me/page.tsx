import Link from "next/link";
import { requireStaff } from "@/lib/team/auth";
import TeamHeader from "../team-header";
import { isAdminRole } from "@/lib/team/roles";
import { kitItemChoices, listReports } from "@/lib/team/low-stock-db";
import { LEVEL_LABEL, STATUS_LABEL } from "@/lib/team/low-stock";
import { timeLabel } from "@/lib/team/clock-label";
import RunningLowButton from "../running-low";
import { myReceipts } from "@/lib/team/receipts-db";
import { RECEIPT_KIND_LABEL, RECEIPT_STATUS_LABEL } from "@/lib/team/receipts";
import { money } from "@/lib/team/pay";

export const dynamic = "force-dynamic";

// The staff member's own pages.
const PAGES: { href: string; title: string; detail: string }[] = [
  { href: "/team/me/profile", title: "My profile", detail: "Email, home address, drop off time, and how far you will drive." },
  { href: "/team/availability", title: "Availability", detail: "Mark the days you cannot work." },
  { href: "/team/training", title: "Training", detail: "Getting started, and a guide to every package." },
  { href: "/team/certifications", title: "My certifications", detail: "Upload your TABC (or California RBS) and food handler certificates and see when they expire." },
  { href: "/team/pay", title: "My pay", detail: "Estimated pay by event, week, and month." },
  { href: "/team/record", title: "My record", detail: "Events worked, on time, bar ready, closeouts, and handoffs." },
];

export default async function MePage() {
  const staff = await requireStaff("/team/me");
  // Only this person's own reports, whatever their role: the admin list is on the admin side.
  const [mine, receipts] = await Promise.all([
    listReports({ ...staff, role: "bartender" }, { limit: 10 }).then((list) => list.filter((r) => r.staffId === staff.id)),
    // Only receipts this person paid for, never anyone else's. Empty before the migration.
    myReceipts(staff).catch(() => ({ ready: false, receipts: [] })),
  ]);
  return (
    <>
      <TeamHeader signedIn admin={isAdminRole(staff.role)} back={{ href: "/team/events", label: "Events" }} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">{staff.name || "Me"}</h1>
          <p className="text-[15px] text-[#6B5D52]">Only you and the Mix Fix admins see these.</p>
        </div>
        <ul className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] divide-y divide-[#DDD5CC] overflow-hidden">
          {PAGES.map((p) => (
            <li key={p.href}>
              <Link href={p.href} className="block px-4 py-3 hover:bg-[#EFE7DF] transition-colors">
                <span className="block font-heading font-bold text-[#2C2420]">{p.title}</span>
                <span className="block text-sm text-[#6B5D52]">{p.detail}</span>
              </Link>
            </li>
          ))}
        </ul>
        <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 space-y-2" aria-label="My receipts">
          <div>
            <h2 className="font-heading text-base font-bold text-[#2C2420]">My receipts</h2>
            <p className="text-sm text-[#6B5D52]">Receipts you added on your events, newest first. Add one from the event&apos;s Receipts tab.</p>
          </div>
          {receipts.receipts.length === 0 ? (
            <p className="text-[15px] text-[#6B5D52]">No receipts yet.</p>
          ) : (
            <ul className="divide-y divide-[#DDD5CC]">
              {receipts.receipts.map((r) => (
                <li key={r.id} className="py-2 text-[15px] text-[#2C2420]">
                  <span className="font-medium">
                    {RECEIPT_KIND_LABEL[r.kind]} {money(r.cents)}
                  </span>
                  <span className="text-[#6B5D52]">
                    {" "}
                    ·{" "}
                    {r.open ? (
                      <Link href={`/team/e/${encodeURIComponent(r.sessionId)}?tab=receipts`} className="text-[#B5845A] underline">
                        {r.eventTitle}
                      </Link>
                    ) : (
                      r.eventTitle
                    )}
                    {r.eventDay && `, ${new Date(`${r.eventDay}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })}`}
                  </span>
                  <span className={`block text-sm ${r.status === "approved" ? "text-[#55684A]" : r.status === "not_approved" ? "text-[#A0412D]" : "text-[#9A7049]"}`}>
                    {RECEIPT_STATUS_LABEL[r.status]}
                    {r.status === "not_approved" && r.reason ? `: ${r.reason}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 space-y-3">
          <div>
            <h2 className="font-heading text-base font-bold text-[#2C2420]">Running low on your kit?</h2>
            <p className="text-sm text-[#6B5D52]">Your own tools, or stock for a future event. At an event today, use the Running low button on the event instead.</p>
          </div>
          <RunningLowButton sessionId={null} items={kitItemChoices()} kit />
          {mine.length > 0 && (
            <ul className="divide-y divide-[#DDD5CC]">
              {mine.map((r) => (
                <li key={r.id} className="py-2 text-[15px] text-[#2C2420]">
                  <span className="font-medium">{r.item}</span>, {LEVEL_LABEL[r.level].toLowerCase()}
                  {r.eventTitle && <span className="text-[#6B5D52]"> · {r.eventTitle}</span>}
                  <span className="block text-sm text-[#6B5D52]">
                    {timeLabel(r.createdAt)} · {r.status === "on_it" ? `${r.takenBy} is on it` : STATUS_LABEL[r.status]}
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
