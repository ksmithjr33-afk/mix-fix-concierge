import Link from "next/link";
import { requireStaff } from "@/lib/team/auth";
import { onboardingDone } from "@/lib/team/certs-db";
import { onboardingItem } from "@/lib/team/cert-config";
import TeamHeader from "../../team-header";
import AckButton from "./ack-button";

export const dynamic = "force-dynamic";

// One onboarding step: a short page of text from the config, then acknowledge.
export default async function OnboardingItemPage({ params }: { params: Promise<{ item: string }> }) {
  const { item: id } = await params;
  const staff = await requireStaff(`/team/onboarding/${encodeURIComponent(id)}`);
  const item = onboardingItem(id);
  const back = { href: "/team/onboarding", label: "Getting started" };
  if (!item) {
    return (
      <>
        <TeamHeader signedIn admin={staff.role === "admin"} back={back} />
        <main className="max-w-md mx-auto px-4 py-10 text-center text-[15px] text-[#6B5D52]">We could not find that step.</main>
      </>
    );
  }
  const done = (await onboardingDone(staff.id)).has(item.id);
  return (
    <>
      <TeamHeader signedIn admin={staff.role === "admin"} back={back} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <h1 className="font-heading text-2xl font-bold text-[#2C2420] px-1">{item.title}</h1>
        <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4 space-y-3">
          {item.id === "name_phone" && (
            <dl className="rounded-xl bg-white border border-[#DDD5CC] px-3 py-2 text-[15px]">
              <div className="flex justify-between gap-3 py-1">
                <dt className="text-[#6B5D52]">Name</dt>
                <dd className="text-[#2C2420] font-medium text-right break-words">{staff.name || "Not set"}</dd>
              </div>
              <div className="flex justify-between gap-3 py-1">
                <dt className="text-[#6B5D52]">Phone</dt>
                <dd className="text-[#2C2420] font-medium">{staff.phone}</dd>
              </div>
            </dl>
          )}
          {item.body.map((p, i) => (
            <p key={i} className="text-[15px] text-[#2C2420] leading-relaxed">
              {p}
            </p>
          ))}
          {item.link && (
            <Link href={item.link.href} className="inline-block text-[15px] text-[#B5845A] underline">
              {item.link.label}
            </Link>
          )}
        </section>
        <AckButton itemId={item.id} label={item.ack} done={done} />
      </main>
    </>
  );
}
