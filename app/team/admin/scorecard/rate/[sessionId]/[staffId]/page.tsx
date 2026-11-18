import Link from "next/link";
import type { Metadata } from "next";
import { requireScorecard } from "@/lib/team/scorecard-page";
import { dateWords, rateForm } from "@/lib/team/scorecard-db";
import { MARKS, NOT_READY, OUTCOME_LABEL, SCORECARD_PATH, avgText } from "@/lib/team/scorecard";
import { chicagoStamp } from "@/lib/team/time";
import TeamHeader from "../../../../../team-header";
import RateForm from "./rate-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rate", robots: { index: false, follow: false } };

const card = "rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3";

// Rate one person on one event: the facts first, then the seven marks.
// Admins and managers only, never themselves, only after the event ends.
export default async function RatePage({ params }: { params: Promise<{ sessionId: string; staffId: string }> }) {
  const { sessionId, staffId } = await params;
  const me = await requireScorecard(`${SCORECARD_PATH}/rate/${sessionId}/${staffId}`);
  const r = await rateForm(me, sessionId, staffId);
  if (!r.ok) {
    return (
      <>
        <TeamHeader signedIn admin back={{ href: SCORECARD_PATH, label: "Scorecard" }} />
        <main className="max-w-md mx-auto px-4 py-10 text-center text-[15px] text-[#6B5D52]">{r.error}</main>
      </>
    );
  }
  const f = r.form;
  const tz = f.timeZone;
  const at = (iso: string | null) => (iso ? chicagoStamp(iso, tz) : "");
  const facts: { label: string; value: string; bad?: boolean }[] = [
    { label: "Arrival", value: f.facts.arrival ? `Scheduled ${at(f.facts.arrival)}, clocked in ${f.facts.clockIn ? at(f.facts.clockIn) : "never"}: ${f.facts.arrivalText}` : f.facts.arrivalText, bad: !f.facts.clockIn || /late/.test(f.facts.arrivalText) },
    { label: "Clock out", value: f.facts.clockOut ? at(f.facts.clockOut) : f.facts.clockIn ? "Missing clock out" : "No clock out", bad: !f.facts.clockOut },
    { label: "Tools confirmed", value: f.facts.toolsConfirmedAt ? at(f.facts.toolsConfirmedAt) : "Not confirmed", bad: !f.facts.toolsConfirmedAt },
    { label: "Supplies confirmed", value: f.facts.suppliesConfirmedAt ? at(f.facts.suppliesConfirmedAt) : "Not confirmed", bad: !f.facts.suppliesConfirmedAt },
    { label: "Bar setup photo", value: f.facts.barPhotoAt ? `In, ${at(f.facts.barPhotoAt)}` : "Missing", bad: !f.facts.barPhotoAt },
    { label: "Closeout report", value: f.facts.closeoutAt ? `In, ${at(f.facts.closeoutAt)}` : "Missing", bad: !f.facts.closeoutAt },
    {
      label: "Running low reports",
      value: f.facts.lowStock.length ? f.facts.lowStock.map((l) => `${l.item} (${l.level === "out" ? "out" : "low"}, ${at(l.at)})`).join("; ") : "None sent",
    },
    {
      label: "Check in call",
      value: f.facts.call
        ? [f.facts.call.done ? "Done" : "Not done", f.facts.call.outcome ? OUTCOME_LABEL[f.facts.call.outcome] : "", f.facts.call.confidence ? `confidence ${f.facts.call.confidence}` : "", f.facts.call.by ? `by ${f.facts.call.by}` : ""].filter(Boolean).join(", ")
        : "Not logged",
    },
  ];
  const existing = f.rating;

  return (
    <>
      <TeamHeader signedIn admin back={{ href: SCORECARD_PATH, label: "Scorecard" }} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Rate {f.name}</h1>
          <p className="text-[15px] text-[#6B5D52]">
            <Link href={`/team/admin/e/${sessionId}?tab=dayof`} className="underline">
              {f.title}
            </Link>
            {f.day ? `, ${dateWords(f.day)}` : ""}
          </p>
          {existing && (
            <p className="text-sm text-[#6B5D52]">
              Rated by {existing.rated_by_name || "someone"} {at(existing.rated_at)}
              {existing.updated_at !== existing.rated_at ? `, last edited by ${existing.updated_by_name || "someone"} ${at(existing.updated_at)}` : ""} · average {avgText(existing.average) || "none"}
            </p>
          )}
        </div>
        {!f.ready && <p className="rounded-2xl bg-[#FFF8EC] border border-[#E3C9A0] px-4 py-3 text-[15px] text-[#2C2420]">{NOT_READY}</p>}
        <section className={card}>
          <h2 className="font-heading font-bold text-[#2C2420] mb-1">What the app has</h2>
          <dl className="space-y-1">
            {facts.map((x) => (
              <div key={x.label} className="grid grid-cols-[9rem_1fr] gap-2 text-sm">
                <dt className="text-[#6B5D52]">{x.label}</dt>
                <dd className={x.bad ? "text-[#A0412D]" : "text-[#2C2420]"}>{x.value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <RateForm
          sessionId={sessionId}
          staffId={staffId}
          marks={MARKS.map((m) => ({ key: m.key, label: m.label, help: m.help }))}
          initial={
            existing
              ? {
                  marks: Object.fromEntries(MARKS.map((m) => [m.key, existing[m.key]])),
                  markNotes: existing.mark_notes ?? {},
                  clientFeedback: existing.client_feedback,
                  adminNotes: existing.admin_notes,
                }
              : null
          }
          suggested={f.suggested}
        />
        {f.history.length > 0 && (
          <section className={card}>
            <h2 className="font-heading font-bold text-[#2C2420] mb-1">Edit history</h2>
            <ul className="space-y-1 text-sm text-[#2C2420]">
              {f.history.map((h, i) => (
                <li key={i}>
                  <span className="text-[#6B5D52]">
                    {at(h.at)} by {h.by || "someone"}:
                  </span>{" "}
                  {MARKS.map((m) => `${m.label} ${h.marks[m.key] ?? "blank"}`).join(", ")}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
