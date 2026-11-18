import Link from "next/link";
import type { RateTeamCard as Card } from "@/lib/team/scorecard-db";

// "Rate the team" on Day of: admins and managers only (the card is null for
// anyone else), never the viewer. Shows once the event ends.
export default function RateTeamCard({ sessionId, card }: { sessionId: string; card: Card }) {
  if (!card.over || card.people.length === 0) return null;
  const left = card.people.filter((p) => !p.rated).length;
  return (
    <section className="rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Rate the team</h2>
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${left ? "bg-[#F6E3DC] text-[#A0412D]" : "bg-[#E4EBDF] text-[#55684A]"}`}>{left ? `${left} to rate` : "All rated"}</span>
      </div>
      <ul className="divide-y divide-[#EFE8E0]">
        {card.people.map((p) => (
          <li key={p.staffId} className="py-2 flex items-center justify-between gap-2 text-sm">
            <span className="text-[#2C2420]">{p.name}</span>
            <Link href={`/team/admin/scorecard/rate/${encodeURIComponent(sessionId)}/${p.staffId}`} className={p.rated ? "text-[#6B5D52] underline" : "rounded-lg border border-[#B5845A] px-3 py-1 text-[#9A7049]"}>
              {p.rated ? `Rated ${p.average?.toFixed(2) ?? ""}, edit` : "Rate"}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
