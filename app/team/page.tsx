import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/team/auth";
import TeamHeader from "./team-header";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function TeamLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" && params.next.startsWith("/team/") ? params.next : "/team/events";
  if (await getCurrentStaff()) redirect(next);

  return (
    <>
      <TeamHeader signedIn={false} />
      <main className="max-w-md mx-auto px-4 py-10">
        <h1 className="font-heading text-2xl font-bold text-[#2C2420] mb-1">Team sign in</h1>
        <p className="text-[15px] text-[#6B5D52] mb-6">Enter your phone number and we will text you a code.</p>
        <LoginForm next={next} />
      </main>
    </>
  );
}
