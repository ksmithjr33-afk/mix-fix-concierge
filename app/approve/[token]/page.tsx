import { approvalByToken } from "@/lib/partners/approvals";
import { firstWord } from "@/lib/partners/rules";
import TokenAction from "@/app/token-action";

export const dynamic = "force-dynamic";
export const metadata = { title: "The Mix Fix | Approve a change", robots: { index: false, follow: false } };

/** The client approves or declines a price change their planner asked for. Nothing changes without a yes. */
export default async function ApproveChangePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await approvalByToken(token);
  const answered: Record<string, string> = {
    approved: "You already approved this change. It is saved.",
    declined: "You declined this change, so nothing changed.",
    expired: "This change was not answered in time, so nothing changed. Ask your planner to send it again if you still want it.",
    stale: "The price changed since this was quoted, so nothing changed. Ask your planner to send it again.",
  };
  return (
    <div className="min-h-dvh bg-[#E8DDD5] flex items-center justify-center px-4">
      <main className="max-w-md w-full bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-5 py-6 space-y-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="The Mix Fix" className="h-10" />
        {!a || a.holder !== "client" ? (
          <p className="text-[16px] text-[#2C2420]">This link is no longer active. Questions? Text us at 469 754 8512.</p>
        ) : a.status !== "pending" ? (
          <p className="text-[16px] text-[#2C2420]">{answered[a.status]}</p>
        ) : (
          <>
            <h1 className="font-heading text-xl font-bold text-[#2C2420]">A change that affects your price</h1>
            <p className="text-[16px] text-[#2C2420]">
              {firstWord(a.asked_by_name) || "Your planner"} asked for: {a.summary}
            </p>
            <p className="text-[16px] text-[#2C2420]">{a.price_text}</p>
            <p className="text-sm text-[#6B5D52]">Nothing changes unless you approve.</p>
            <TokenAction
              url="/api/approve-change"
              token={token}
              actions={[
                { label: "Approve", body: { yes: true }, done: "Approved. The change is saved and your total is updated.", tone: "go" },
                { label: "Decline", body: { yes: false }, done: "Declined. Nothing changed.", tone: "stop" },
              ]}
            />
          </>
        )}
      </main>
    </div>
  );
}
