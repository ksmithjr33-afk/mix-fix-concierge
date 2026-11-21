// The event home's sections, shared by the client's page (app/s) and the
// planner's event page (app/partners/e/[key]): the top with the countdown and
// status line, "What we need from you", your day, your bar team, payment, your
// agreement, your requests, and help. Presentational only: what each viewer
// may see is decided before it gets here (lib/event-home-db.ts). Every line
// speaks to the reader.

import { HELP_LINE, TEAM_LATER, type DayLine, type PaymentView, type PendingRequest, type TeamMember, type TodoItem } from "@/lib/event-home";

export function HomeCard({ title, id, children, action = null }: { title: string; id?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section id={id} aria-label={title} className="scroll-mt-4 bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-bold text-[#2C2420]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function HomeTop({ title, date, countdown, status, badge = null, children = null }: { title: string; date: string; countdown: string; status: string; badge?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section data-home-top className="px-1 space-y-1">
      <h1 className="font-heading text-2xl font-bold text-[#2C2420]">{title}</h1>
      {badge}
      {date && <p className="text-[15px] text-[#2C2420]">{date}</p>}
      {(countdown || status) && (
        <p className="text-[15px] text-[#6B5D52]">
          {countdown && <span className="font-semibold text-[#B5845A]">{countdown}</span>}
          {countdown && status ? " · " : ""}
          {status}
        </p>
      )}
      {children && <div className="pt-2">{children}</div>}
    </section>
  );
}

export function Checklist({ items, renderAction }: { items: TodoItem[]; renderAction: (item: TodoItem) => React.ReactNode }) {
  if (items.length === 0) return null;
  return (
    <HomeCard title="What we need from you" id="what-we-need">
      <ul className="space-y-2" data-checklist>
        {items.map((it) => (
          <li key={it.key} className={`rounded-xl px-3 py-2.5 ${it.done ? "bg-[#EEF3EA] border border-[#CFDCC6]" : "bg-[#FFF8EC] border border-[#E3C9A0]"}`}>
            <p className="text-[15px] text-[#2C2420]">
              <span aria-hidden className="mr-1.5">{it.done ? "✓" : "○"}</span>
              <span className="sr-only">{it.done ? "Done: " : "To do: "}</span>
              {it.label}
            </p>
            {!it.done && it.action && <div className="mt-2">{renderAction(it)}</div>}
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}

export function YourDay({ lines, address = "", contact = "" }: { lines: DayLine[]; address?: string; contact?: string }) {
  if (lines.length === 0 && !address) return null;
  return (
    <HomeCard title="Your day" id="your-day">
      <dl className="space-y-1.5" data-your-day>
        {lines.map((l) => (
          <div key={l.label} className="flex flex-wrap justify-between gap-x-3 text-[15px]">
            <dt className="text-[#6B5D52]">{l.label}</dt>
            <dd className="text-[#2C2420] font-medium">{l.value}</dd>
          </div>
        ))}
        {address && (
          <div className="flex flex-wrap justify-between gap-x-3 text-[15px]">
            <dt className="text-[#6B5D52]">Where</dt>
            <dd className="text-[#2C2420] break-words">{address}</dd>
          </div>
        )}
        {contact && (
          <div className="flex flex-wrap justify-between gap-x-3 text-[15px]">
            <dt className="text-[#6B5D52]">Day of contact</dt>
            <dd className="text-[#2C2420] break-words">{contact}</dd>
          </div>
        )}
      </dl>
    </HomeCard>
  );
}

export function BarTeam({ team }: { team: TeamMember[] }) {
  return (
    <HomeCard title="Your bar team" id="bar-team">
      {team.length === 0 ? (
        <p className="text-[15px] text-[#6B5D52]">{TEAM_LATER}</p>
      ) : (
        <ul className="text-[15px] text-[#2C2420] space-y-0.5" data-bar-team>
          {team.map((m, i) => (
            <li key={i}>
              {m.name}
              {m.role && <span className="text-[#6B5D52]">, {m.role}</span>}
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
}

export function PaymentCard({ payment, lines = [] }: { payment: PaymentView | null; lines?: { amount: string; on: string }[] }) {
  if (!payment) return null;
  const row = (label: string, value: string) =>
    value ? (
      <div className="flex flex-wrap justify-between gap-x-3 text-[15px]">
        <dt className="text-[#6B5D52]">{label}</dt>
        <dd className="text-[#2C2420] font-medium">{value}</dd>
      </div>
    ) : null;
  return (
    <HomeCard title="Payment" id="payment">
      <dl className="space-y-1.5" data-payment>
        {row("Package total", payment.total)}
        {row("Balance due by", payment.due)}
        {row("Paid so far", payment.paid)}
        {row("Balance", payment.balance)}
        {row("How you chose to pay", payment.preference)}
      </dl>
      {lines.length > 0 && (
        <ul className="text-sm text-[#6B5D52]">
          {lines.map((l, i) => (
            <li key={i}>
              {l.amount}
              {l.on ? ` paid ${l.on}` : ""}
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
}

export function AgreementCard({ agreements, href }: { agreements: { id: string; label: string; typeLabel: string }[]; href: (id: string, download?: boolean) => string }) {
  if (agreements.length === 0) return null;
  return (
    <HomeCard title="Your agreement" id="agreement">
      <ul className="space-y-2" data-agreement>
        {agreements.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 text-[15px]">
            <span className="text-[#2C2420]">{a.label}</span>
            <a href={href(a.id)} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-[#2C2420] text-white px-3 py-1.5 text-sm font-medium">
              View ({a.typeLabel})
            </a>
            <a href={href(a.id, true)} className="rounded-lg border border-[#2C2420] text-[#2C2420] px-3 py-1.5 text-sm font-medium">
              Download
            </a>
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}

export function RequestsCard({ requests }: { requests: PendingRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <HomeCard title="Your requests" id="your-requests">
      <ul className="space-y-2" data-requests>
        {requests.map((r, i) => (
          <li key={i} className="text-[15px] border-b border-[#DDD5CC] last:border-0 pb-2 last:pb-0">
            <p className="text-[#2C2420] break-words">{r.summary}</p>
            <p className="text-sm text-[#6B5D52]">
              {r.status}
              {r.when ? `, asked ${r.when}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}

export function HelpCard() {
  return (
    <section aria-label="Help" className="text-center py-3">
      <p className="text-[15px] text-[#6B5D52]">
        Questions?{" "}
        <a href="sms:4697548512" className="underline text-[#2C2420] font-medium">
          {HELP_LINE}
        </a>
      </p>
    </section>
  );
}
