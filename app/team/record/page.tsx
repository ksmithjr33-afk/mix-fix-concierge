import type { Metadata } from "next";
import { requireStaff } from "@/lib/team/auth";
import { staffRecord } from "@/lib/team/reliability-db";
import TeamHeader from "../team-header";
import RecordCard from "../record-card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My record", robots: { index: false, follow: false } };

// A bartender's own reliability record. Only ever the signed in person's.
export default async function MyRecordPage() {
  const staff = await requireStaff("/team/record");
  const record = await staffRecord(staff.id);
  return (
    <>
      <TeamHeader signedIn admin={staff.role === "admin"} back={{ href: "/team/me", label: "Me" }} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">My record</h1>
          <p className="text-[15px] text-[#6B5D52]">Only you and the Mix Fix admins see this.</p>
        </div>
        <RecordCard record={record} title="Your record" />
      </main>
    </>
  );
}
