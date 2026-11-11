import Link from "next/link";
import { requireAdmin } from "@/lib/team/auth";
import { supabase } from "@/lib/supabase";
import { todayFor, upcomingUnavailable } from "@/lib/team/availability-db";
import { rangeLabel } from "@/lib/team/availability";
import { staffMarketsOf, marketLabel } from "@/lib/team/markets";
import TeamHeader from "../../../team-header";
import RecordCard from "../../../record-card";
import { staffRecord } from "@/lib/team/reliability-db";
import { certRows, myStandings, onboardingDone } from "@/lib/team/certs-db";
import { STATE_LABELS } from "@/lib/team/certs";
import { CERT_TYPES, ONBOARDING } from "@/lib/team/cert-config";
import { longDate } from "@/lib/team/time";
import CertUpload from "../../../certifications/cert-upload";
import CertReview from "./cert-review";
import RateForm from "./rate-form";
import { rateFor } from "@/lib/team/pay-db";
import { PAY_LABEL } from "@/lib/team/pay";

export const dynamic = "force-dynamic";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";

// One staff member, for admins: availability and the rest of their record.
export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAdmin(`/team/admin/staff/${encodeURIComponent(id)}`);
  const back = { href: "/team/admin/staff", label: "Staff" };
  const { data } = await supabase.from("staff").select("*").eq("id", id).maybeSingle();
  const person = data as { id: string; name: string; role: string; active: boolean; markets?: unknown } | null;
  if (!person) {
    return (
      <>
        <TeamHeader signedIn admin back={back} />
        <main className="max-w-md mx-auto px-4 py-10 text-center text-[15px] text-[#6B5D52]">We could not find that person.</main>
      </>
    );
  }
  const today = await todayFor(id);
  const [away, record, certs, standings, onboard] = await Promise.all([upcomingUnavailable(id, today), staffRecord(id), certRows([id]), myStandings(id), onboardingDone(id)]);
  const needed = [...new Set(standings.map((s) => s.standing.certType))];
  const rate = await rateFor(id); // admins only: this page is behind requireAdmin
  return (
    <>
      <TeamHeader signedIn admin back={back} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420] break-words">{person.name || "No name yet"}</h1>
          <p className="text-[15px] text-[#6B5D52]">
            {[person.role === "admin" ? "Admin" : "Bartender", staffMarketsOf(person).map((m) => marketLabel(m)).join(", "), person.active ? "" : "Inactive"].filter(Boolean).join(" · ")}
          </p>
          <Link href={`/team/admin/preview/${id}`} className="text-sm text-[#B5845A] underline">
            Preview as
          </Link>
        </div>

        <RecordCard record={record} />

        <section className={card} aria-label="Pay">
          <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">Hourly rate</h2>
          <p className="text-sm text-[#6B5D52] mb-2">Only admins and {person.name?.split(" ")[0] || "this person"} see it. Used for the {PAY_LABEL.toLowerCase()}.</p>
          <RateForm staffId={id} initial={rate ? (rate / 100).toFixed(2) : ""} />
        </section>

        <section className={card} aria-label="Certifications">
          <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">Certifications</h2>
          {standings.length > 0 && (
            <ul className="text-[15px] mb-2">
              {standings.map(({ market, standing }) => (
                <li key={market} className="text-[#2C2420]">
                  {marketLabel(market)}: {standing.certType} {STATE_LABELS[standing.state].toLowerCase()}
                  {standing.expiresOn ? `, ${standing.state === "expired" ? "expired" : "expires"} ${longDate(standing.expiresOn)}` : ""}
                </li>
              ))}
            </ul>
          )}
          {certs.length === 0 ? (
            <p className="text-[15px] text-[#6B5D52]">Nothing uploaded yet.</p>
          ) : (
            <ul className="divide-y divide-[#DDD5CC]">
              {certs.map((c) => (
                <li key={c.id} className="py-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[15px] text-[#2C2420]">
                      {c.cert_type}, expires {longDate(c.expires_on)}
                      <span className="block text-xs text-[#6B5D52]">
                        {c.status === "approved" ? "Approved" : c.status === "rejected" ? `Rejected${c.review_note ? `: ${c.review_note}` : ""}` : "Waiting for review"}
                        {c.uploaded_by !== c.staff_id ? " · entered by an admin" : ""}
                      </span>
                    </p>
                    <a href={`/api/team/certs/file?id=${c.id}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-sm text-[#B5845A] underline">
                      View
                    </a>
                  </div>
                  {c.status === "pending" && c.staff_id !== me.id && <CertReview id={c.id} />}
                </li>
              ))}
            </ul>
          )}
          {id !== me.id && (
            <details className="mt-3">
              <summary className="text-sm text-[#B5845A] underline cursor-pointer">Enter a certification for {person.name?.split(" ")[0] || "them"}</summary>
              <div className="mt-2">
                <CertUpload certTypes={needed.length ? needed : CERT_TYPES} defaultType={needed[0] ?? CERT_TYPES[0]} today={today} staffId={id} button="Save certification" />
              </div>
            </details>
          )}
        </section>

        <section className={card} aria-label="Onboarding">
          <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">
            Onboarding: {ONBOARDING.filter((i) => onboard.has(i.id)).length} of {ONBOARDING.length}
          </h2>
          <ul className="text-[15px] space-y-0.5">
            {ONBOARDING.map((i) => (
              <li key={i.id} className={onboard.has(i.id) ? "text-[#2C2420]" : "text-[#A39585]"}>
                {onboard.has(i.id) ? "✓" : "○"} {i.title}
              </li>
            ))}
          </ul>
        </section>

        <section className={card} aria-label="Availability">
          <h2 className="font-heading text-base font-bold text-[#2C2420] mb-2">Availability</h2>
          {away.length === 0 ? (
            <p className="text-[15px] text-[#6B5D52]">No unavailable days coming up.</p>
          ) : (
            <ul className="divide-y divide-[#DDD5CC]">
              {away.map((r) => (
                <li key={r.id} className="py-2">
                  <p className="font-medium text-[#2C2420]">{rangeLabel(r)}</p>
                  {r.note && <p className="text-sm text-[#6B5D52] break-words">{r.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
