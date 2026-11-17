import Link from "next/link";
import { requireStaff } from "@/lib/team/auth";
import { onboardingDone } from "@/lib/team/certs-db";
import { TRAINING_PATH, TRAINING_SECTIONS, TRAINING_TITLE, trainingProgress } from "@/lib/team/training";
import { PACKAGE_GUIDES } from "@/lib/packages-info";
import TeamHeader from "../team-header";
import PackageEntries from "./package-entries";
import { isAdminRole } from "@/lib/team/roles";

export const dynamic = "force-dynamic";

// Training: every section in TRAINING_SECTIONS, each with its own count.
// Getting started is the five onboarding steps, unchanged (each opens its own
// page). Packages is one expandable entry per package guide, legacy last,
// each with Mark as read. Nothing here blocks work.
export default async function TrainingPage() {
  const staff = await requireStaff(TRAINING_PATH);
  const acked = await onboardingDone(staff.id);
  const progress = new Map(trainingProgress(acked).map((p) => [p.id, p]));
  return (
    <>
      <TeamHeader signedIn admin={isAdminRole(staff.role)} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <h1 className="font-heading text-2xl font-bold text-[#2C2420] px-1">{TRAINING_TITLE}</h1>
        {TRAINING_SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="space-y-3" aria-label={s.title}>
            <div className="px-1">
              <h2 className="font-heading text-xl font-bold text-[#2C2420]">{s.title}</h2>
              <p className="text-[15px] text-[#6B5D52]">{s.intro}</p>
              <p className="text-sm text-[#6B5D52] mt-1" data-count={s.id}>
                {progress.get(s.id)?.text}
              </p>
            </div>
            {s.id === "packages" ? (
              <PackageEntries guides={PACKAGE_GUIDES} read={s.items.filter((i) => acked.has(i.ackId)).map((i) => i.ackId)} />
            ) : (
              <ul className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] divide-y divide-[#DDD5CC] overflow-hidden">
                {s.items.map((i) => (
                  <li key={i.ackId}>
                    <Link href={i.href ?? "#"} className="flex items-center gap-3 px-4 py-3 hover:bg-[#EFE7DF] transition-colors">
                      <span
                        aria-label={acked.has(i.ackId) ? "Done" : "Not done"}
                        className={`shrink-0 h-6 w-6 rounded-full border-2 flex items-center justify-center text-xs font-bold ${acked.has(i.ackId) ? "bg-[#8B9E7E] border-[#8B9E7E] text-white" : "border-[#DDD5CC]"}`}
                      >
                        {acked.has(i.ackId) ? "✓" : ""}
                      </span>
                      <span className="font-medium text-[#2C2420]">{i.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </main>
    </>
  );
}
