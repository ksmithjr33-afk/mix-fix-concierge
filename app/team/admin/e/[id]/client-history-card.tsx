import Link from "next/link";
import CopyButton from "../../copy-button";
import type { ClientHistoryView } from "@/lib/client-history-db";
import { longDate } from "@/lib/team/time";
import { money } from "@/lib/price-change";

const STATUS_TONE: Record<string, string> = {
  upcoming: "bg-[#E6EFE0] text-[#3F5A33]",
  past: "bg-[#EEE8E2] text-[#6B5D52]",
  "details pending": "bg-[#FBEBD3] text-[#9A5B12]",
  hidden: "bg-[#EEE8E2] text-[#8A7B6E]",
};

// Manager view, Details tab, admins only: this client's other events, newest
// first. The page builds it only when Details is open and only for admins.
export default function ClientHistoryCard({ history, clientKey, title = "Client history" }: { history: ClientHistoryView; clientKey: string; title?: string }) {
  return (
    <section className="rounded-2xl border border-[#DDD5CC] bg-white p-4 space-y-3" aria-label={title}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-heading text-base font-bold text-[#2C2420]">{title}</h2>
        {clientKey && (
          <Link href={`/team/admin/clients/${encodeURIComponent(clientKey)}`} className="text-sm text-[#B5845A] underline">
            Client page
          </Link>
        )}
      </div>
      {history.rows.length === 0 ? (
        <p className="text-sm text-[#6B5D52]">{title === "Client history" ? "No other events for this client." : "No events."}</p>
      ) : (
        <ul className="divide-y divide-[#EEE8E2]">
          {history.rows.map((r) => (
            <li key={r.id} className="py-2.5 space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {r.managerHref ? (
                  <Link href={r.managerHref} className="font-medium text-[#2C2420] underline decoration-[#DDD5CC]">
                    {r.title}
                  </Link>
                ) : (
                  <span className="font-medium text-[#2C2420]">{r.title}</span>
                )}
                <span className={`text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_TONE[r.status]}`}>{r.status}</span>
                {r.matchedBy === "phone" && (
                  <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F6E3DC] text-[#A0412D]" title="Different email, same phone number. Check it is the same client.">
                    matched by phone
                  </span>
                )}
              </div>
              <p className="text-sm text-[#6B5D52]">
                {[r.day ? longDate(r.day) : r.dateText, r.pkg, r.guests ? `${r.guests} guests` : "", r.total !== null ? `${money(r.total)} booked` : ""].filter(Boolean).join(" · ")}
              </p>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={r.conciergeUrl} label="Copy concierge link" />
                <CopyButton text={r.eventUrl} label="Copy event page link" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
