import Link from "next/link";
import type { Metadata } from "next";
import { requireScorecard } from "@/lib/team/scorecard-page";
import { rankBoard } from "@/lib/team/scorecard-ranks-db";
import { OFFERS_PATH, RANK_NOT_READY } from "@/lib/team/scorecard-ranks";
import { SCORECARD_PATH } from "@/lib/team/scorecard";
import TeamHeader from "../../../team-header";
import OfferBoard from "./offer-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Offer order", robots: { index: false, follow: false } };

// The offer order: three tiers with a ranked order inside each, per market.
// Admins change it; managers only view it; nobody sees their own row (403 for
// anyone but admins and managers). Staff never see any of this.
export default async function OfferOrderPage() {
  const me = await requireScorecard(OFFERS_PATH);
  const board = await rankBoard(me);
  return (
    <>
      <TeamHeader signedIn admin back={{ href: SCORECARD_PATH, label: "Scorecard" }} />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Offer order</h1>
          <p className="text-[15px] text-[#6B5D52]">
            Who gets shift offers first, by tier and then by rank. Your order always wins; what the reviews suggest is shown next to it. Staff never see any of this.
          </p>
        </div>
        {board && !board.ready && <p className="rounded-2xl bg-[#FFF8EC] border border-[#E3C9A0] px-4 py-3 text-[15px] text-[#2C2420]">{RANK_NOT_READY}</p>}
        {board && <OfferBoard board={board} />}
        <p className="px-1 text-xs text-[#A39585]">
          The posted shift way still works on every event: post it, people request it, and you pick. <Link href={SCORECARD_PATH} className="underline">Back to the Scorecard</Link>
        </p>
      </main>
    </>
  );
}
