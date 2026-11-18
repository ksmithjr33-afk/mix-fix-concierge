import { redirect } from "next/navigation";
import { requirePrincipal } from "@/lib/partners/auth";
import PartnerHeader from "../partner-header";
import ProfileForm from "./profile-form";

export const dynamic = "force-dynamic";

export default async function PartnerProfilePage() {
  const me = await requirePrincipal();
  if (me.kind !== "partner") redirect("/partners");
  const p = me.partner;
  return (
    <>
      <PartnerHeader signedIn name={p.name} />
      <main className="max-w-md mx-auto px-4 py-6 space-y-4">
        <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Your profile</h1>
        <ProfileForm initial={{ name: p.name, company: p.company, email: p.email, website: p.website }} phone={p.phone} />
      </main>
    </>
  );
}
