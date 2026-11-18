import { linkByRemoveToken } from "@/lib/partners/db";
import { plannerWho } from "@/lib/partners/rules";
import TokenAction from "@/app/token-action";

export const dynamic = "force-dynamic";
export const metadata = { title: "The Mix Fix | Remove planner", robots: { index: false, follow: false } };

/**
 * The client's remove link from the text. Tapping Remove ends the planner's
 * access at once. It is a button rather than the link itself, so a text app's
 * link preview can never remove anyone by loading the page.
 */
export default async function PlannerRemovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await linkByRemoveToken(token);
  return (
    <div className="min-h-dvh bg-[#E8DDD5] flex items-center justify-center px-4">
      <main className="max-w-md w-full bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-5 py-6 space-y-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="The Mix Fix" className="h-10" />
        {!found || !found.partner ? (
          <p className="text-[16px] text-[#2C2420]">This link is no longer active. That planner may already be removed. Questions? Text us at 469 754 8512.</p>
        ) : (
          <>
            <p className="text-[16px] text-[#2C2420]">{plannerWho(found.partner)} has access to your bar planning with The Mix Fix. Remove them?</p>
            <TokenAction
              url="/api/planner-remove"
              token={token}
              actions={[{ label: `Remove ${found.partner.name || "them"}`, body: {}, done: "Done. They no longer have access to your bar planning.", tone: "stop" }]}
            />
          </>
        )}
      </main>
    </div>
  );
}
