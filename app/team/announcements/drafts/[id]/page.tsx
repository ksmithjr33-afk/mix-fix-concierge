import { requireStaff } from "@/lib/team/auth";
import { draftFor } from "@/lib/team/announcement-drafts-db";
import TeamHeader from "../../../team-header";
import AttachmentView from "../../../attachment-view";
import { isAdminRole } from "@/lib/team/roles";

export const dynamic = "force-dynamic";

function at(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(/[  ]/g, " ");
}

// A draft shown exactly the way staff will see it once sent. "Send a test to
// me" links here. Admins and managers only: staff never see a draft.
export default async function DraftTestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff(`/team/announcements/drafts/${encodeURIComponent(id)}`);
  const admin = isAdminRole(staff.role);
  const back = { href: "/team/announcements", label: "Announcements" };
  const draft = admin ? await draftFor(staff, id) : null;
  if (!draft) {
    return (
      <>
        <TeamHeader signedIn admin={admin} back={back} />
        <main className="max-w-md mx-auto px-4 py-10 text-center">
          <p className="text-[15px] text-[#6B5D52]">We could not find that announcement.</p>
        </main>
      </>
    );
  }
  return (
    <>
      <TeamHeader signedIn admin={admin} back={back} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <p className="text-sm text-[#6B5D52] bg-[#FBF3E4] rounded-xl border border-[#E8D5B5] px-3 py-2">
          Test view. This is how staff will see it. It is still a draft and nobody else has it.
        </p>
        <article className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4 space-y-2">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420] break-words">{draft.title || "Untitled"}</h1>
          <p className="text-xs text-[#A39585]">{at(draft.updatedAt)}</p>
          {draft.attachment && <AttachmentView attachment={{ id: draft.attachment.id, kind: draft.attachment.kind, url: draft.attachment.url, removed: false }} isAdmin={false} />}
          <p className="text-[15px] text-[#2C2420] whitespace-pre-wrap break-words">{draft.body}</p>
        </article>
      </main>
    </>
  );
}
