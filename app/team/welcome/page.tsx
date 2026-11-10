import { redirect } from "next/navigation";
import { getCurrentStaff, needsName } from "@/lib/team/auth";
import TeamHeader from "../team-header";
import NameForm from "./name-form";

export const dynamic = "force-dynamic";

// Asked once, on the first sign in by someone we do not have a name for.
export default async function TeamWelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" && params.next.startsWith("/team/") ? params.next : "/team/events";
  const staff = await getCurrentStaff();
  if (!staff) redirect(`/team?next=${encodeURIComponent(next)}`);
  if (!needsName(staff)) redirect(next);

  return (
    <>
      <TeamHeader signedIn />
      <main className="max-w-md mx-auto px-4 py-10">
        <h1 className="font-heading text-2xl font-bold text-[#2C2420] mb-1">Welcome to the team portal</h1>
        <p className="text-[15px] text-[#6B5D52] mb-6">What is your name? We only ask once.</p>
        <NameForm next={next} />
      </main>
    </>
  );
}
