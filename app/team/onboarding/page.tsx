import Link from "next/link";
import { requireStaff } from "@/lib/team/auth";
import { onboardingDone } from "@/lib/team/certs-db";
import { ONBOARDING, ONBOARDING_INTRO, ONBOARDING_TITLE } from "@/lib/team/cert-config";
import TeamHeader from "../team-header";

export const dynamic = "force-dynamic";

// The onboarding checklist. Each step opens a short page; nothing here blocks work.
export default async function OnboardingPage() {
  const staff = await requireStaff("/team/onboarding");
  const done = await onboardingDone(staff.id);
  const count = ONBOARDING.filter((i) => done.has(i.id)).length;
  return (
    <>
      <TeamHeader signedIn admin={staff.role === "admin"} back={{ href: "/team/me", label: "Me" }} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">{ONBOARDING_TITLE}</h1>
          <p className="text-[15px] text-[#6B5D52]">{ONBOARDING_INTRO}</p>
          <p className="text-sm text-[#6B5D52] mt-1">
            {count} of {ONBOARDING.length} done
          </p>
        </div>
        <ul className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] divide-y divide-[#DDD5CC] overflow-hidden">
          {ONBOARDING.map((i) => (
            <li key={i.id}>
              <Link href={`/team/onboarding/${i.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[#EFE7DF] transition-colors">
                <span
                  aria-label={done.has(i.id) ? "Done" : "Not done"}
                  className={`shrink-0 h-6 w-6 rounded-full border-2 flex items-center justify-center text-xs font-bold ${done.has(i.id) ? "bg-[#8B9E7E] border-[#8B9E7E] text-white" : "border-[#DDD5CC]"}`}
                >
                  {done.has(i.id) ? "✓" : ""}
                </span>
                <span className="font-medium text-[#2C2420]">{i.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
