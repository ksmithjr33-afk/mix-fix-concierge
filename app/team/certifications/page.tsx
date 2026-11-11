import { requireStaff } from "@/lib/team/auth";
import { certRows, certsEnforced, myStandings } from "@/lib/team/certs-db";
import { STATE_LABELS, blocks } from "@/lib/team/certs";
import { CERT_TYPES } from "@/lib/team/cert-config";
import { marketLabel, marketTz } from "@/lib/team/markets";
import { longDate, todayIn } from "@/lib/team/time";
import TeamHeader from "../team-header";
import CertUpload from "./cert-upload";

export const dynamic = "force-dynamic";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";
const tone: Record<string, string> = {
  ok: "bg-[#E4EBDF] text-[#55684A]",
  pending: "bg-[#FFF3DF] text-[#9A7049]",
  rejected: "bg-[#F6E3DC] text-[#A0412D]",
  expired: "bg-[#F6E3DC] text-[#A0412D]",
  missing: "bg-[#F6E3DC] text-[#A0412D]",
};

// A bartender's own certifications: what each market needs, what is on file, and upload.
export default async function CertificationsPage() {
  const staff = await requireStaff("/team/certifications");
  const [standings, rows, enforced] = await Promise.all([myStandings(staff.id), certRows([staff.id]), certsEnforced()]);
  const types = [...new Map(standings.map((s) => [s.standing.certType, s])).values()];
  const today = todayIn(marketTz(standings[0]?.market ?? null));
  const needed = types.map((t) => t.standing.certType);
  return (
    <>
      <TeamHeader signedIn admin={staff.role === "admin"} back={{ href: "/team/me", label: "Me" }} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">My certifications</h1>
          <p className="text-[15px] text-[#6B5D52]">Each market needs a current alcohol server certification. We text you before yours expires.</p>
        </div>
        {standings.map(({ market, standing }) => (
          <section key={market} className={card}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-heading text-base font-bold text-[#2C2420]">
                {marketLabel(market)}: {standing.certType}
              </h2>
              <span className={`text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${tone[standing.state]}`}>{STATE_LABELS[standing.state]}</span>
            </div>
            {standing.expiresOn && <p className="text-sm text-[#6B5D52]">{standing.state === "expired" ? "Expired" : "Expires"} {longDate(standing.expiresOn)}</p>}
            {standing.state === "rejected" && standing.row?.review_note && <p className="text-sm text-[#A0412D]">Note from the office: {standing.row.review_note}</p>}
            {blocks(standing.state) && (
              <p className="text-sm text-[#A0412D] mt-1">
                {enforced ? `You cannot request ${marketLabel(market)} shifts until a current ${standing.certType} is on file.` : `${marketLabel(market)} shifts need a current ${standing.certType}. Upload it below.`}
              </p>
            )}
          </section>
        ))}
        <section className={card}>
          <h2 className="font-heading text-base font-bold text-[#2C2420] mb-2">Upload a certificate</h2>
          <CertUpload certTypes={needed.length ? needed : CERT_TYPES} defaultType={(needed[0] ?? CERT_TYPES[0]) as string} today={today} />
        </section>
        {rows.length > 0 && (
          <section className={card}>
            <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">On file</h2>
            <ul className="divide-y divide-[#DDD5CC]">
              {rows.map((r) => (
                <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] text-[#2C2420]">
                      {r.cert_type}, expires {longDate(r.expires_on)}
                    </p>
                    <p className="text-xs text-[#6B5D52]">{r.status === "approved" ? "Approved" : r.status === "rejected" ? `Rejected${r.review_note ? `: ${r.review_note}` : ""}` : "Waiting for review"}</p>
                  </div>
                  <a href={`/api/team/certs/file?id=${r.id}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-sm text-[#B5845A] underline">
                    View
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
