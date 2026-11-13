import CopyButton from "../../copy-button";

// The client's links on the manager view's Details tab, admins only (the page
// is behind requireAdmin and the bartender view never imports this): their
// concierge link and event page link with Copy and Open, and a line saying
// whether they finished the concierge and when they last opened or updated it.

function LinkRow({ label, url, open }: { label: string; url: string; open: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-[#A39585] uppercase tracking-wide">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-white border border-[#DDD5CC] px-3 py-2 text-sm text-[#2C2420]">{url}</code>
        <CopyButton text={url} />
        <a href={open} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg border-2 border-[#B5845A] text-[#9A7049] px-3 py-1.5 text-sm font-medium">
          Open
        </a>
      </div>
    </div>
  );
}

export default function ClientLinksCard({ conciergeUrl, eventUrl, openConcierge, openEvent, status }: { conciergeUrl: string; eventUrl: string; openConcierge: string; openEvent: string; status: string }) {
  return (
    <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4 space-y-3">
      <h2 className="font-heading text-base font-bold text-[#2C2420]">Client links</h2>
      <LinkRow label="Concierge link" url={conciergeUrl} open={openConcierge} />
      <LinkRow label="Event page" url={eventUrl} open={openEvent} />
      <p className="text-sm text-[#6B5D52]">{status}</p>
      <p className="text-xs text-[#A39585]">Open from here does not count as the client opening it.</p>
    </section>
  );
}
