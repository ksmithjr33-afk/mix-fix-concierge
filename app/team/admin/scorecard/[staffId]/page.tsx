import Link from "next/link";
import type { Metadata } from "next";
import { requireScorecard } from "@/lib/team/scorecard-page";
import { dateWords, personCard } from "@/lib/team/scorecard-db";
import { MARKS, NOT_READY, OUTCOME_LABEL, SCORECARD_PATH, TIER_LABEL, avgText, lowestMark, markAverage } from "@/lib/team/scorecard";
import { chicagoStamp, chicagoToday } from "@/lib/team/time";
import { marketLabel } from "@/lib/team/markets";
import TeamHeader from "../../../team-header";
import TierBadge from "../tier-badge";
import Reviews from "./reviews";
import PayrollTick from "./payroll-tick";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scorecard", robots: { index: false, follow: false } };

const card = "rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3";

/** The last ratings as a small line, oldest to newest, on a 1 to 5 scale. */
function Trend({ points }: { points: number[] }) {
  if (points.length < 2) return <p className="text-sm text-[#6B5D52]">{points.length ? `One rated event: ${points[0].toFixed(2)}` : "No rated events yet."}</p>;
  const w = 240;
  const h = 56;
  const x = (i: number) => 6 + (i * (w - 12)) / (points.length - 1);
  const y = (v: number) => 6 + ((5 - v) * (h - 12)) / 4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-xs h-14" role="img" aria-label={`Last ${points.length} ratings: ${points.map((p) => p.toFixed(1)).join(", ")}`}>
      <line x1="6" x2={w - 6} y1={y(4.5)} y2={y(4.5)} stroke="#DDD5CC" strokeDasharray="3 3" />
      <polyline fill="none" stroke="#B5845A" strokeWidth="2" points={points.map((p, i) => `${x(i)},${y(p)}`).join(" ")} />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p)} r="3" fill={p < 4 ? "#A0412D" : "#B5845A"} />
      ))}
    </svg>
  );
}

export default async function PersonScorecard({ params, searchParams }: { params: Promise<{ staffId: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { staffId } = await params;
  const me = await requireScorecard(`${SCORECARD_PATH}/${staffId}`);
  const r = await personCard(me, staffId);
  const back = { href: SCORECARD_PATH, label: "Scorecard" };
  if (!r.ok) {
    return (
      <>
        <TeamHeader signedIn admin back={back} />
        <main className="max-w-md mx-auto px-4 py-10 text-center text-[15px] text-[#6B5D52]">{r.error}</main>
      </>
    );
  }
  const kind = (await searchParams).type;
  const c = r.card;
  const row = c.row;
  const res = row.result;
  const weakest = Math.min(...MARKS.map((m) => res.markAvgs[m.key] ?? 6));

  return (
    <>
      <TeamHeader signedIn admin back={back} />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420] flex flex-wrap items-center gap-2">
            {row.name} <TierBadge tier={TIER_LABEL[res.tier]} title={res.reason} />
          </h1>
          <p className="text-[15px] text-[#6B5D52]">
            {row.marketLabel}
            {row.rank ? ` · rank #${row.rank} in ${row.marketLabel.split(", ")[0]}` : res.tier === "new" ? " · not ranked yet" : ""}
            {Object.keys(row.ranks).length > 1 ? ` (${Object.entries(row.ranks).map(([m, n]) => `#${n} ${marketLabel(m)}`).join(", ")})` : ""}
          </p>
          <p className="text-xs text-[#6B5D52]">{res.reason}</p>
        </div>
        {!c.ready && <p className="rounded-2xl bg-[#FFF8EC] border border-[#E3C9A0] px-4 py-3 text-[15px] text-[#2C2420]">{NOT_READY}</p>}

        <section className={`${card} grid grid-cols-2 sm:grid-cols-4 gap-3`}>
          <div>
            <p className="text-xs text-[#6B5D52]">Last {c.settings.window} average</p>
            <p className="font-heading text-xl font-bold text-[#2C2420]">{avgText(res.lastAvg) || "none"}</p>
          </div>
          <div>
            <p className="text-xs text-[#6B5D52]">All time average</p>
            <p className="font-heading text-xl font-bold text-[#2C2420]">{avgText(res.allAvg) || "none"}</p>
          </div>
          <div>
            <p className="text-xs text-[#6B5D52]">Lowest mark, last {c.settings.window}</p>
            <p className="font-heading text-xl font-bold text-[#2C2420]">{res.lowest ?? "none"}</p>
          </div>
          <div>
            <p className="text-xs text-[#6B5D52]">Rated of worked</p>
            <p className="font-heading text-xl font-bold text-[#2C2420]">
              {res.rated} of {row.worked}
            </p>
          </div>
          <div className="col-span-2 sm:col-span-4">
            <p className="text-xs text-[#6B5D52] mb-1">Last {res.trend.length} ratings, oldest to newest</p>
            <Trend points={res.trend} />
          </div>
        </section>

        <section className={card}>
          <h2 className="font-heading font-bold text-[#2C2420] mb-2">Each mark, averaged</h2>
          <ul className="space-y-1.5">
            {MARKS.map((m) => {
              const v = res.markAvgs[m.key];
              const weak = v !== null && v === weakest && v < 4.5;
              return (
                <li key={m.key} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-2 text-sm">
                  <span className={weak ? "font-bold text-[#A0412D]" : "text-[#2C2420]"}>{m.label}</span>
                  <span className="h-2 rounded bg-[#EFE8E0] overflow-hidden">
                    <span className={`block h-full ${weak ? "bg-[#A0412D]" : "bg-[#B5845A]"}`} style={{ width: `${v ? (v / 5) * 100 : 0}%` }} />
                  </span>
                  <span className="tabular-nums text-right">{avgText(v) || "none"}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={card}>
          <h2 className="font-heading font-bold text-[#2C2420] mb-1">Reliability, last 90 days</h2>
          <p className="text-xs text-[#6B5D52] mb-1">Facts from the clock, closeouts and offers. Shown beside the score; they do not change it.</p>
          <ul className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
            <li>Late arrivals: <b>{row.facts.late}</b></li>
            <li>Missing clock outs: <b>{row.facts.noClockOut}</b></li>
            <li>Declined: <b>{row.facts.declined}</b></li>
            <li>Handed off: <b>{row.facts.handedOff}</b></li>
            <li>Missing closeouts: <b>{row.facts.noCloseout}</b></li>
          </ul>
          <p className="mt-2 text-sm text-[#2C2420]">
            Onboarding {row.onboarding.done} of {row.onboarding.total} done{row.onboarding.done >= row.onboarding.total ? " (manual read)" : ""}
            {row.cert ? ` · ${row.cert}` : ""}
          </p>
          <PayrollTick staffId={staffId} done={c.payroll.done} by={c.payroll.by} at={c.payroll.at ? chicagoStamp(c.payroll.at) : null} canTick={c.canTickPayroll} />
        </section>

        <section className="space-y-2">
          <h2 className="px-1 font-heading text-lg font-bold text-[#2C2420]">Rated events</h2>
          {c.ratings.length === 0 ? (
            <p className={`${card} text-[15px] text-[#6B5D52]`}>No ratings yet.</p>
          ) : (
            <ul className="space-y-2">
              {c.ratings.map((x) => (
                <li key={x.sessionId} className={card}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-heading font-bold text-[#2C2420]">
                      {x.title} <span className="font-normal text-sm text-[#6B5D52]">{dateWords(x.day)}</span>
                    </span>
                    <Link href={`${SCORECARD_PATH}/rate/${x.sessionId}/${staffId}`} className="text-sm text-[#9A7049] underline">
                      Edit
                    </Link>
                  </div>
                  <p className="text-sm text-[#2C2420]">
                    Average <b>{avgText(markAverage(x.marks)) || "none"}</b> · lowest {lowestMark(x.marks) ?? "none"}
                  </p>
                  <p className="text-xs text-[#6B5D52]">{MARKS.map((m) => `${m.label} ${x.marks[m.key] ?? "blank"}`).join(" · ")}</p>
                  {MARKS.filter((m) => x.markNotes[m.key]).map((m) => (
                    <p key={m.key} className="text-sm text-[#A0412D]">
                      {m.label}: {x.markNotes[m.key]}
                    </p>
                  ))}
                  {x.clientFeedback && <p className="text-sm text-[#2C2420]">Client feedback: {x.clientFeedback}</p>}
                  {x.adminNotes && <p className="text-sm text-[#2C2420]">Admin notes: {x.adminNotes}</p>}
                  <p className="text-xs text-[#A39585]">
                    Rated by {x.ratedBy || "someone"} {chicagoStamp(x.ratedAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="px-1 font-heading text-lg font-bold text-[#2C2420]">Check in calls</h2>
          {c.calls.length === 0 ? (
            <p className={`${card} text-[15px] text-[#6B5D52]`}>No calls logged.</p>
          ) : (
            <ul className={`${card} divide-y divide-[#EFE8E0]`}>
              {c.calls.map((x) => (
                <li key={x.sessionId} className="py-2 text-sm">
                  <span className="font-medium text-[#2C2420]">{x.title}</span> <span className="text-[#6B5D52]">{dateWords(x.day)}</span>
                  <span className="block text-[#2C2420]">
                    {[x.done ? "Done" : "Not done", x.outcome ? OUTCOME_LABEL[x.outcome] : "", x.confidence ? `confidence ${x.confidence}` : "", x.by ? `by ${x.by}` : "", x.at ? chicagoStamp(x.at) : ""].filter(Boolean).join(" · ")}
                  </span>
                  {x.notes && <span className="block text-[#6B5D52]">{x.notes}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <Reviews
          staffId={staffId}
          today={chicagoToday()}
          filter={typeof kind === "string" ? kind : ""}
          reviews={c.reviews.map((x) => ({ ...x, dateText: dateWords(x.date), createdText: chicagoStamp(x.createdAt), editedText: x.editedAt ? chicagoStamp(x.editedAt) : null }))}
        />
      </main>
    </>
  );
}
