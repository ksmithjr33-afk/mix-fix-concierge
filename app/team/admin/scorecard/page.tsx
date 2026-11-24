import Link from "next/link";
import type { Metadata } from "next";
import { requireScorecard } from "@/lib/team/scorecard-page";
import { dateWords, roster, tierSettings, toRate } from "@/lib/team/scorecard-db";
import { NOT_READY, SCORECARD_PATH, TIER_LABEL } from "@/lib/team/scorecard";
import { OFFERS_PATH } from "@/lib/team/scorecard-ranks";
import { MARKETS, MARKET_INFO, marketLabel } from "@/lib/team/markets";
import { isFullAdmin } from "@/lib/team/roles";
import { chicagoStamp } from "@/lib/team/time";
import TeamHeader from "../../team-header";
import RosterTable, { type RosterItem } from "./roster-table";
import SettingsForm from "./settings-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scorecard", robots: { index: false, follow: false } };

// The Scorecard: admins and managers only (403 for anyone else), never the
// viewer's own row. The To rate list, then the roster.
const card = "rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3";
const pill = "rounded-full px-3 py-2 text-sm min-h-[44px] inline-flex items-center bg-[#EFE8E0] text-[#2C2420]";

export default async function ScorecardPage() {
  const me = await requireScorecard(SCORECARD_PATH);
  const now = new Date();
  const [r, rate, settings] = await Promise.all([roster(me, now), toRate(me, now), tierSettings()]);
  const rows: RosterItem[] = (r?.rows ?? []).map((x) => ({
    staffId: x.staffId,
    name: x.name,
    markets: x.markets.map((m) => ({ key: m, label: marketLabel(m) })),
    marketLabel: x.marketLabel,
    worked: x.worked,
    rated: x.result.rated,
    lastAvg: x.result.lastAvg,
    allAvg: x.result.allAvg,
    lowest: x.result.lowest,
    tier: TIER_LABEL[x.result.tier],
    tierWhy: x.result.reason,
    ranks: x.ranks,
    rank: x.rank,
    lastEvent: x.lastEvent ? dateWords(x.lastEvent) : null,
    lastEventDay: x.lastEvent,
    facts: x.facts,
    onboarding: `${x.onboarding.done} of ${x.onboarding.total}`,
    onboardingDone: x.onboarding.done >= x.onboarding.total,
    cert: x.cert,
    manualSigned: x.manualSigned,
    payrollDone: x.payrollDone,
  }));

  return (
    <>
      <TeamHeader signedIn admin />
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Scorecard</h1>
          <p className="text-[15px] text-[#6B5D52]">Ratings, tiers and ranks. Admins and managers only. Staff never see any of this.</p>
        </div>
        {r && !r.ready && <p className="rounded-2xl bg-[#FFF8EC] border border-[#E3C9A0] px-4 py-3 text-[15px] text-[#2C2420]">{NOT_READY}</p>}
        <nav className="flex flex-wrap gap-2" aria-label="Scorecard">
          <Link href={OFFERS_PATH} className={pill}>
            Offer order
          </Link>
          <Link href={`${SCORECARD_PATH}/calls`} className={pill}>
            Check in calls
          </Link>
          <a href="/api/team/admin/scorecard/export?kind=roster" className={pill}>
            Roster CSV
          </a>
          <a href="/api/team/admin/scorecard/export?kind=ratings" className={pill}>
            Ratings CSV
          </a>
        </nav>

        <section className="space-y-2">
          <h2 className="px-1 font-heading text-lg font-bold text-[#2C2420]">To rate</h2>
          <p className="px-1 text-sm text-[#6B5D52]">Events from the last 14 days with people not rated yet, oldest first.</p>
          {!rate || rate.length === 0 ? (
            <p className={`${card} text-[15px] text-[#6B5D52]`}>Everyone is rated. Nice.</p>
          ) : (
            <ul className="space-y-2">
              {rate.map((e) => (
                <li key={e.sessionId} className={`${card} ${e.late ? "border-[#A0412D] bg-[#FDF3F0]" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/team/admin/e/${e.sessionId}?tab=dayof`} className="font-heading font-bold text-[#2C2420] underline decoration-[#DDD5CC]">
                      {e.title}
                    </Link>
                    <span className="text-sm text-[#6B5D52]">{dateWords(e.day)}</span>
                    {e.late && <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F6E3DC] text-[#A0412D]">Over 48 hours</span>}
                  </div>
                  <p className="text-xs text-[#6B5D52]">Ended {chicagoStamp(e.endedAt)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {e.people.map((p) => (
                      <Link key={p.staffId} href={`${SCORECARD_PATH}/rate/${e.sessionId}/${p.staffId}`} className="rounded-lg border border-[#B5845A] px-3 py-1.5 text-sm text-[#9A7049]">
                        Rate {p.name}
                      </Link>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="px-1 font-heading text-lg font-bold text-[#2C2420]">Roster</h2>
          <p className="px-1 text-sm text-[#6B5D52]">
            Tiers over the last {settings.window} rated events. Ace: average {settings.aceAvg} or higher and no mark below {settings.aceMin}. Solid: average {settings.solidAvg} or higher. Coach: below {settings.solidAvg}, or a mark of {settings.coachLow} or lower in the last {settings.coachRecent}. New: fewer than {settings.newUnder} rated events. The 90 day facts sit beside the score and never change it.
          </p>
          <RosterTable rows={rows} markets={MARKETS.map((m) => ({ key: m, label: MARKET_INFO[m].label }))} window={settings.window} />
        </section>

        {isFullAdmin(me.role) && (
          <details className={card}>
            <summary className="cursor-pointer font-heading font-bold text-[#2C2420]">Tier settings</summary>
            <SettingsForm initial={settings} />
          </details>
        )}
      </main>
    </>
  );
}
