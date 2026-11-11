import Link from "next/link";
import { requireStaff } from "@/lib/team/auth";
import TeamHeader from "../team-header";

export const dynamic = "force-dynamic";

// The staff member's own pages.
const PAGES: { href: string; title: string; detail: string }[] = [
  { href: "/team/availability", title: "Availability", detail: "Mark the days you cannot work." },
  { href: "/team/onboarding", title: "Getting started", detail: "Five short steps for new bartenders." },
  { href: "/team/certifications", title: "My certifications", detail: "Upload your TABC or California RBS and see when it expires." },
  { href: "/team/pay", title: "My pay", detail: "Estimated pay by event, week, and month." },
  { href: "/team/record", title: "My record", detail: "Events worked, on time, bar ready, closeouts, and handoffs." },
];

export default async function MePage() {
  const staff = await requireStaff("/team/me");
  return (
    <>
      <TeamHeader signedIn admin={staff.role === "admin"} back={{ href: "/team/events", label: "Events" }} />
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
      </main>
    </>
  );
}
