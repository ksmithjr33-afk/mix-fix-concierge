import Link from "next/link";
import { requireStaff } from "@/lib/team/auth";
import { viewProfile } from "@/lib/team/profile-db";
import TeamHeader from "../../team-header";
import ProfileForm from "./profile-form";

export const dynamic = "force-dynamic";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";

// The staff member's own profile. After sign in, a bartender with gaps is sent
// here once (first=1) and can skip it.
export default async function MyProfilePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const first = q.first === "1";
  const next = typeof q.next === "string" && q.next.startsWith("/team/") ? q.next : undefined;
  const staff = await requireStaff("/team/me/profile");
  const profile = await viewProfile(staff, staff.id);
  const certsMissing = profile ? profile.certTypes.filter((t) => profile.missing.includes(t)) : [];
  return (
    <>
      <TeamHeader signedIn admin={staff.role === "admin"} back={first ? undefined : { href: "/team/me", label: "Me" }} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">{first ? "Finish your profile" : "My profile"}</h1>
          <p className="text-[15px] text-[#6B5D52]">
            {first ? "A few details help the office plan drop offs and send you to events you can reach. We only ask once." : "Only you and the Mix Fix admins see your home address and email."}
          </p>
        </div>
        {profile && (
          <section className={card}>
            <ProfileForm initial={profile} next={first ? (next ?? "/team/events") : undefined} />
          </section>
        )}
        <section className={card}>
          <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">Certificates</h2>
          <p className="text-[15px] text-[#6B5D52]">
            {certsMissing.length ? `Still needed: ${certsMissing.join(", ")}. ` : "Your certificates are on file. "}
            Upload each certificate with its expiration date on{" "}
            <Link href="/team/certifications" className="text-[#B5845A] underline">
              My certifications
            </Link>
            .
          </p>
        </section>
        {first && (
          <p className="px-1">
            <Link href={next ?? "/team/events"} className="text-sm text-[#6B5D52] underline">
              Skip for now
            </Link>
          </p>
        )}
      </main>
    </>
  );
}
