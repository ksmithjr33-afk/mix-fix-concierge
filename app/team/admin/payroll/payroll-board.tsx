"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hoursText, money, rateText } from "@/lib/team/pay";
import { timeLabel } from "@/lib/team/clock-label";
import { weekStart } from "@/lib/team/timesheet";
import {
  changedText,
  dayLabel,
  FILTER_LABEL,
  FILTERS,
  filterEvents,
  FIX_HOURS,
  lineHours,
  lineRateText,
  overText,
  pctText,
  PROBLEM_TEXT,
  SHEET_PEOPLE,
  type PayrollFilter,
  type PayrollLine,
  type PayrollPerson,
  type PayrollView,
  type SheetEvent,
} from "@/lib/team/payroll";
import { FROM_RECEIPT_MESSAGE, KIND_LABEL, LOCKED_MESSAGE, PICKUP_PROMPT, REIMBURSEMENT_KINDS, REIMBURSEMENTS_NOT_READY, type Reimbursement, type ReimbursementKind } from "@/lib/team/reimbursements";
import { receiptPhotoHref } from "@/lib/team/receipts";
import { managerHref } from "@/lib/team/manager-tabs";

/** The small "receipt" link on a reimbursement that came from a receipt: opens the photo after the access check. */
function ReceiptLink({ r }: { r: Reimbursement }) {
  if (!r.receiptId) return null;
  return (
    <a href={receiptPhotoHref(r.receiptId)} target="_blank" rel="noopener noreferrer" className="text-xs text-[#B5845A] underline" aria-label={`Receipt for ${KIND_LABEL[r.kind]} ${money(r.cents)}`}>
      receipt
    </a>
  );
}

const PROMPT_RECEIPT: Record<keyof typeof PICKUP_PROMPT, string> = {
  ice: "Picked up the ice and submitted a receipt. Review it",
  menu_printing: "Picked up the menus and submitted a receipt. Review it",
};

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";
const input = "rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30";
const th = "px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[#6B5D52] whitespace-nowrap";
const td = "px-2 py-2 align-top text-sm text-[#2C2420] tabular-nums";
const num = `${td} text-right whitespace-nowrap`;
const link = "text-sm text-[#B5845A] underline min-h-[44px] inline-flex items-center";

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/team/admin/payroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Could not save.");
  return data;
}

const FILTER_KEY = "payroll_filter";
const tipsText = (l: PayrollLine) => (l.tipsCents === null ? "not on file" : money(l.tipsCents));
const hoursCell = (l: PayrollLine) => {
  const h = lineHours(l);
  return h.minutes === null ? "none" : `${hoursText(h.minutes)}${h.estimate ? " est" : ""}`;
};

interface Actions {
  ready: boolean;
  reimbursementsReady: boolean;
  busy: string;
  toggle: (l: PayrollLine) => void;
  editReimbursements: (l: PayrollLine, kind?: ReimbursementKind) => void;
}

// The weekly payout sheet: one row per event, the Pay Out table, the paid checkboxes. Admins only.
export default function PayrollBoard({ view, today }: { view: PayrollView; today: string }) {
  const router = useRouter();
  const week = view.period.key === "week" ? view.period : null;
  const [filter, setFilter] = useState<PayrollFilter>("all");
  const [paidOn, setPaidOn] = useState(view.period.payDate ?? today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<{ assignmentId: string; kind?: ReimbursementKind } | null>(null);

  // Remember the filter in this browser.
  useEffect(() => {
    try {
      const f = localStorage.getItem(FILTER_KEY) as PayrollFilter | null;
      if (f && (FILTERS as readonly string[]).includes(f)) setFilter(f);
    } catch {
      /* no storage */
    }
  }, []);

  const pick = (f: PayrollFilter) => {
    setFilter(f);
    try {
      localStorage.setItem(FILTER_KEY, f);
    } catch {
      /* no storage */
    }
  };

  const run = async (key: string, body: Record<string, unknown>, done?: (data: Record<string, unknown>) => string): Promise<boolean> => {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      const data = await post(body);
      if (done) setMessage(done(data));
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      return false;
    } finally {
      setBusy("");
    }
  };

  const toggle = (l: PayrollLine) => {
    if (l.paid) {
      if (!window.confirm(`Undo paid for ${l.name}, ${dayLabel(l.eventDay)}, ${l.eventTitle}?`)) return;
      return void run(l.assignmentId, { action: "undo", assignmentId: l.assignmentId });
    }
    return void run(l.assignmentId, { action: "mark", assignmentId: l.assignmentId, paidOn, note });
  };

  const markAll = (p: PayrollPerson) => {
    if (!window.confirm(`Mark ${p.payableUnpaid} ${p.payableUnpaid === 1 ? "line" : "lines"} paid for ${p.name}, pay date ${dayLabel(paidOn)}?`)) return;
    return run(`all:${p.staffId}`, { action: "mark_all", staffId: p.staffId, from: view.period.from, to: view.period.to, paidOn, note }, (d) => {
      const skipped = Number(d.skipped ?? 0);
      return `Marked ${d.marked} paid for ${p.name}.${skipped ? ` ${skipped} left: fix hours first.` : ""}`;
    });
  };

  const markWeek = () => {
    if (!week) return;
    const n = view.summary.payableUnpaid;
    if (!window.confirm(`Mark ${n} ${n === 1 ? "line" : "lines"} paid for the week, pay date ${dayLabel(week.payDate)}?`)) return;
    return run("week", { action: "mark_week", from: week.from, to: week.to, note }, (d) => {
      const skipped = Number(d.skipped ?? 0);
      return `Marked ${d.marked} paid for the week, pay date ${dayLabel(week.payDate)}.${skipped ? ` ${skipped} left: fix hours first.` : ""}`;
    });
  };

  const actions: Actions = { ready: view.ready, reimbursementsReady: view.reimbursementsReady, busy, toggle, editReimbursements: (l, kind) => setEditing({ assignmentId: l.assignmentId, kind }) };
  const events = filterEvents(view.events, filter);
  const lineFor = (id: string) => view.events.flatMap((e) => e.lines).find((l) => l.assignmentId === id) ?? null;
  const editLine = editing ? lineFor(editing.assignmentId) : null;

  return (
    <div className="space-y-4">
      <section className={card} aria-label="Marking paid">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f} type="button" onClick={() => pick(f)} className={`rounded-full px-3 py-2 text-sm min-h-[44px] ${filter === f ? "bg-[#2C2420] text-white" : "bg-white text-[#2C2420] border border-[#DDD5CC]"}`}>
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <label className="text-xs text-[#A39585] uppercase tracking-wide">
            Pay date
            <input type="date" className={`${input} block mt-1`} value={paidOn} onChange={(e) => setPaidOn(e.target.value || view.period.payDate || today)} />
          </label>
          <label className="text-xs text-[#A39585] uppercase tracking-wide grow">
            Note (optional)
            <input type="text" maxLength={120} className={`${input} block mt-1 w-full`} placeholder="Gusto run Nov 16" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {week && (
            <button
              type="button"
              disabled={!view.ready || view.summary.payableUnpaid === 0 || !!busy}
              onClick={markWeek}
              className="rounded-lg bg-[#55684A] text-white px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-40"
            >
              {busy === "week" ? "Saving..." : "Mark the week paid"}
            </button>
          )}
        </div>
        <p className="text-xs text-[#6B5D52] mt-2">
          The pay date and note go on every line you mark paid.{week ? ` Mark the week paid marks every line with clocked hours, pay date ${dayLabel(week.payDate)}.` : ""}
        </p>
        {error && <p className="text-sm text-[#A0412D] mt-2">{error}</p>}
        {message && <p className="text-sm text-[#55684A] mt-2">{message}</p>}
      </section>

      {view.events.length === 0 ? (
        <p className={`${card} text-[15px] text-[#6B5D52]`}>Nobody worked an event in this period.</p>
      ) : events.length === 0 ? (
        <p className={`${card} text-[15px] text-[#6B5D52]`}>No events match this filter.</p>
      ) : (
        <>
          <section className={`${card} hidden md:block px-0 sm:px-0`} aria-label="Events">
            <div className="overflow-x-auto">
              <SheetTable events={events} a={actions} />
            </div>
          </section>
          <div className="md:hidden space-y-3" aria-label="Events">
            {events.map((e) => (
              <EventCard key={e.sessionId} e={e} a={actions} />
            ))}
          </div>
        </>
      )}

      {view.people.length > 0 && <PayOut view={view} busy={busy} markAll={markAll} />}

      {editLine && <ReimbursementEditor line={editLine} startKind={editing?.kind} ready={view.reimbursementsReady} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ----- The sheet, wide screens: one row per event, a sub row per person -----

function SheetTable({ events, a }: { events: SheetEvent[]; a: Actions }) {
  return (
    <table className="min-w-full border-collapse">
      <thead className="border-b-2 border-[#2C2420]">
        <tr>
          <th className={th}>Date</th>
          <th className={th}>Client</th>
          <th className={th}>Package</th>
          <th className={th}>Person</th>
          <th className={`${th} text-right`}>Hours</th>
          <th className={`${th} text-right`}>Rate</th>
          <th className={`${th} text-right`}>Hourly</th>
          <th className={`${th} text-right`}>Gas</th>
          <th className={`${th} text-right`}>Reimbursed</th>
          <th className={`${th} text-right`}>Gratuity</th>
          <th className={`${th} text-right`}>Amount</th>
          <th className={th}>Paid</th>
          <th className={`${th} text-right`}>To bartenders</th>
          <th className={`${th} text-right`}>Revenue</th>
          <th className={`${th} text-right`}>Pay %</th>
          <th className={`${th} text-right`}>Profit before supplies</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => {
          const span = Math.max(1, e.lines.length);
          const ev = "border-b border-[#DDD5CC]";
          return e.lines.map((l, i) => (
            <tr key={l.assignmentId} className={i === e.lines.length - 1 ? ev : ""}>
              {i === 0 && (
                <>
                  <td className={`${td} whitespace-nowrap`} rowSpan={span}>
                    {dayLabel(e.day)}
                  </td>
                  <td className={`${td} min-w-[10rem]`} rowSpan={span}>
                    <Link href={`/team/admin/e/${encodeURIComponent(e.sessionId)}`} className="font-medium underline decoration-[#DDD5CC]">
                      {e.title}
                    </Link>
                    {e.lines.length > SHEET_PEOPLE && <span className="block text-xs text-[#9A7049]">{e.lines.length} people</span>}
                  </td>
                  <td className={td} rowSpan={span}>
                    {e.packageName || "None"}
                  </td>
                </>
              )}
              <td className={`${td} min-w-[9rem]`}>
                <PersonName l={l} />
                <LineNotes l={l} a={a} />
              </td>
              <td className={num}>{hoursCell(l)}</td>
              <td className={num}>
                {rateText(l.rateCents)}
                <span className="block text-xs text-[#6B5D52]">{lineRateText(l)}</span>
              </td>
              <td className={num}>{money(l.wagesCents)}</td>
              <td className={num}>{money(l.mileageCents)}</td>
              <td className={num}>
                <ReimbursedButton l={l} a={a} />
              </td>
              <td className={num}>{tipsText(l)}</td>
              <td className={`${num} font-bold`}>{money(l.totalCents)}</td>
              <td className={td}>
                <PaidBox l={l} a={a} />
              </td>
              {i === 0 && (
                <>
                  <td className={`${num} font-bold`} rowSpan={span}>
                    {money(e.toStaffCents)}
                  </td>
                  <td className={num} rowSpan={span}>
                    {e.revenueCents === null ? "not set" : money(e.revenueCents)}
                  </td>
                  <td className={num} rowSpan={span}>
                    {pctText(e.payPct)}
                  </td>
                  <td className={num} rowSpan={span}>
                    {e.profitBeforeSuppliesCents === null ? "" : money(e.profitBeforeSuppliesCents)}
                  </td>
                </>
              )}
            </tr>
          ));
        })}
      </tbody>
    </table>
  );
}

// ----- The sheet, phones: a stacked card per event -----

function EventCard({ e, a }: { e: SheetEvent; a: Actions }) {
  return (
    <section className={card} aria-label={e.title}>
      <p className="text-sm text-[#6B5D52]">{dayLabel(e.day)}</p>
      <h2 className="font-heading text-lg font-bold text-[#2C2420] break-words">
        <Link href={`/team/admin/e/${encodeURIComponent(e.sessionId)}`}>{e.title}</Link>
      </h2>
      <p className="text-sm text-[#6B5D52]">{e.packageName || "No package"}</p>
      <ul className="mt-2 divide-y divide-[#DDD5CC]">
        {e.lines.map((l) => (
          <li key={l.assignmentId} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <PersonName l={l} />
              </div>
              <div className="shrink-0 text-right">
                <p className="font-heading font-bold text-[#2C2420] tabular-nums">{money(l.totalCents)}</p>
                <PaidBox l={l} a={a} />
              </div>
            </div>
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm text-[#2C2420] tabular-nums">
              <dt className="text-[#6B5D52]">Hours</dt>
              <dd className="text-right">{hoursCell(l)}</dd>
              <dt className="text-[#6B5D52]">Rate</dt>
              <dd className="text-right">
                {rateText(l.rateCents)} <span className="text-xs text-[#6B5D52]">{lineRateText(l)}</span>
              </dd>
              <dt className="text-[#6B5D52]">Hourly</dt>
              <dd className="text-right">{money(l.wagesCents)}</dd>
              <dt className="text-[#6B5D52]">Gas</dt>
              <dd className="text-right">{money(l.mileageCents)}</dd>
              <dt className="text-[#6B5D52]">Reimbursed</dt>
              <dd className="text-right">
                <ReimbursedButton l={l} a={a} />
              </dd>
              <dt className="text-[#6B5D52]">Gratuity</dt>
              <dd className="text-right">{tipsText(l)}</dd>
            </dl>
            <LineNotes l={l} a={a} />
          </li>
        ))}
      </ul>
      <dl className="mt-1 border-t-2 border-[#2C2420] pt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm text-[#2C2420] tabular-nums">
        <dt className="font-bold">To bartenders</dt>
        <dd className="text-right font-bold">{money(e.toStaffCents)}</dd>
        <dt>Revenue</dt>
        <dd className="text-right">{e.revenueCents === null ? "not set" : money(e.revenueCents)}</dd>
        <dt>Pay % of revenue</dt>
        <dd className="text-right">{pctText(e.payPct)}</dd>
        <dt>Profit before supplies</dt>
        <dd className="text-right">{e.profitBeforeSuppliesCents === null ? "" : money(e.profitBeforeSuppliesCents)}</dd>
      </dl>
    </section>
  );
}

// ----- Pieces shared by both layouts -----

function PersonName({ l }: { l: PayrollLine }) {
  return (
    <p className="font-medium text-[#2C2420] break-words">
      {l.name}
      {l.role !== "bartender" && <span className="text-xs font-normal text-[#6B5D52]"> ({l.role.replace(/_/g, " ")})</span>}
    </p>
  );
}

function PaidBox({ l, a }: { l: PayrollLine; a: Actions }) {
  if (l.payable || l.paid) {
    return (
      <label className="inline-flex items-center gap-2 text-sm text-[#2C2420] min-h-[44px]">
        <input type="checkbox" className="h-5 w-5 accent-[#55684A]" checked={!!l.paid} disabled={!a.ready || !!a.busy} onChange={() => a.toggle(l)} aria-label={l.paid ? `Paid, ${l.name}. Uncheck to undo` : `Mark paid, ${l.name}`} />
        {a.busy === l.assignmentId ? "Saving..." : "Paid"}
      </label>
    );
  }
  const timeHref = `/team/admin/timesheets?week=${weekStart(l.eventDay ?? new Date().toISOString().slice(0, 10))}&event=${encodeURIComponent(l.sessionId)}`;
  return (
    <Link href={timeHref} className="block text-sm font-medium text-[#A0412D] underline min-h-[44px] pt-2 whitespace-nowrap">
      {FIX_HOURS}
    </Link>
  );
}

function ReimbursedButton({ l, a }: { l: PayrollLine; a: Actions }) {
  const can = a.reimbursementsReady;
  const fromReceipts = l.reimbursements.filter((r) => r.receiptId);
  return (
    <>
      <button type="button" onClick={() => a.editReimbursements(l)} disabled={!can} className="tabular-nums underline decoration-[#DDD5CC] disabled:no-underline" aria-label={`Reimbursements for ${l.name}`}>
        {money(l.reimbursementsCents)}
        {l.reimbursements.length > 0 && <span className="block text-xs text-[#6B5D52]">{l.reimbursements.map((r) => KIND_LABEL[r.kind]).join(", ")}</span>}
      </button>
      {fromReceipts.length > 0 && (
        <span className="flex flex-wrap justify-end gap-x-2">
          {fromReceipts.map((r) => (
            <ReceiptLink key={r.id} r={r} />
          ))}
        </span>
      )}
    </>
  );
}

function LineNotes({ l, a }: { l: PayrollLine; a: Actions }) {
  const at = (iso: string | null) => (iso ? timeLabel(iso, new Date(0), l.timeZone) : null);
  return (
    <div className="space-y-1">
      <p className="text-xs text-[#6B5D52]">
        In {at(l.clockIn) ?? <span className="text-[#A0412D]">missing</span>} · Out {at(l.clockOut) ?? <span className="text-[#A0412D]">missing</span>}
      </p>
      {!l.payable && !l.paid && l.problem && <p className="text-xs text-[#A0412D]">{PROBLEM_TEXT[l.problem]}. Hourly is the estimate until the hours are in.</p>}
      {l.paid && (
        <p className="text-xs text-[#55684A]">
          Paid {dayLabel(l.paid.paidOn)} · marked by {l.paid.markedByName} {timeLabel(l.paid.markedAt, new Date(0))}
          {l.paid.note && ` · ${l.paid.note}`}
        </p>
      )}
      {l.changed && (
        <p className="rounded-lg bg-[#FBE9E4] px-2 py-1 text-xs text-[#A0412D]">
          <span className="font-bold">Changed after it was marked paid.</span> {changedText(l.changed)}
        </p>
      )}
      {a.reimbursementsReady &&
        !l.paid &&
        l.prompts.map((k) =>
          l.promptReceipts[k] ? (
            <Link key={k} href={managerHref(l.sessionId, "receipts")} className="block text-left rounded-lg bg-[#FFF3DF] px-2 py-1 text-xs text-[#9A7049] underline">
              {PROMPT_RECEIPT[k]}
            </Link>
          ) : (
            <button key={k} type="button" onClick={() => a.editReimbursements(l, k)} className="block text-left rounded-lg bg-[#FFF3DF] px-2 py-1 text-xs text-[#9A7049] underline">
              {PICKUP_PROMPT[k]}
            </button>
          )
        )}
    </div>
  );
}

// ----- PAY OUT: one row per person, what gets keyed into payroll -----

function PayOut({ view, busy, markAll }: { view: PayrollView; busy: string; markAll: (p: PayrollPerson) => void }) {
  const t = view.people.reduce(
    (s, p) => ({
      events: s.events,
      minutes: s.minutes + p.totals.minutes,
      wages: s.wages + p.totals.wagesCents,
      gas: s.gas + p.totals.mileageCents,
      reimb: s.reimb + p.totals.reimbursementsCents,
      tips: s.tips + p.totals.tipsCents,
      total: s.total + p.totals.totalCents,
      paid: s.paid + p.totals.paidCents,
      unpaid: s.unpaid + p.totals.unpaidCents,
    }),
    { events: view.summary.events, minutes: 0, wages: 0, gas: 0, reimb: 0, tips: 0, total: 0, paid: 0, unpaid: 0 }
  );
  return (
    <section className={card} aria-label="Pay out">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-lg font-bold uppercase tracking-wide text-[#2C2420]">Pay out</h2>
        <p className="font-heading text-lg font-bold text-[#2C2420] tabular-nums">Total to bartenders {money(view.summary.owedCents)}</p>
      </div>
      <p className="text-xs text-[#6B5D52]">One row per person. This is what gets keyed into payroll.</p>
      <div className="overflow-x-auto mt-2">
        <table className="min-w-full border-collapse">
          <thead className="border-b-2 border-[#2C2420]">
            <tr>
              <th className={th}>Person</th>
              <th className={`${th} text-right`}>Events</th>
              <th className={`${th} text-right`}>Hours</th>
              <th className={`${th} text-right`}>Wages</th>
              <th className={`${th} text-right`}>Gas</th>
              <th className={`${th} text-right`}>Reimbursed</th>
              <th className={`${th} text-right`}>Gratuity</th>
              <th className={`${th} text-right`}>Total</th>
              <th className={`${th} text-right`}>Paid</th>
              <th className={`${th} text-right`}>Unpaid</th>
              <th className={th}>
                <span className="sr-only">Mark all paid</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#DDD5CC]">
            {view.people.map((p) => (
              <tr key={p.staffId}>
                <td className={`${td} whitespace-nowrap`}>
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-xs text-[#6B5D52]">{p.role}</span>
                  {p.over40.map((w) => (
                    <span key={w.week} className="block text-xs text-[#9A7049]">
                      40+ hours. {overText(w)}.
                    </span>
                  ))}
                </td>
                <td className={num}>{p.totals.events}</td>
                <td className={num}>{hoursText(p.totals.minutes)}</td>
                <td className={num}>{money(p.totals.wagesCents)}</td>
                <td className={num}>{money(p.totals.mileageCents)}</td>
                <td className={num}>{money(p.totals.reimbursementsCents)}</td>
                <td className={num}>{money(p.totals.tipsCents)}</td>
                <td className={`${num} font-bold`}>{money(p.totals.totalCents)}</td>
                <td className={num}>{money(p.totals.paidCents)}</td>
                <td className={num}>{money(p.totals.unpaidCents)}</td>
                <td className={td}>
                  <button
                    type="button"
                    disabled={!view.ready || p.payableUnpaid === 0 || !!busy}
                    onClick={() => markAll(p)}
                    className="rounded-lg bg-[#B5845A] text-white px-3 py-2 text-sm font-medium min-h-[44px] whitespace-nowrap disabled:opacity-40"
                  >
                    {busy === `all:${p.staffId}` ? "Saving..." : "Mark all paid"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-[#2C2420] font-bold">
            <tr>
              <td className={td}>Total</td>
              <td className={num}>{t.events}</td>
              <td className={num}>{hoursText(t.minutes)}</td>
              <td className={num}>{money(t.wages)}</td>
              <td className={num}>{money(t.gas)}</td>
              <td className={num}>{money(t.reimb)}</td>
              <td className={num}>{money(t.tips)}</td>
              <td className={num}>{money(t.total)}</td>
              <td className={num}>{money(t.paid)}</td>
              <td className={num}>{money(t.unpaid)}</td>
              <td className={td} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-[#6B5D52] mt-2">Hours are clocked hours. Overtime is figured by the payroll provider.</p>
    </section>
  );
}

// ----- Reimbursements for one person on one event -----

function ReimbursementEditor({ line, startKind, ready, onClose }: { line: PayrollLine; startKind?: ReimbursementKind; ready: boolean; onClose: () => void }) {
  const router = useRouter();
  const locked = !!line.paid;
  const [kind, setKind] = useState<ReimbursementKind>(startKind ?? "ice");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      await post(body);
      setAmount("");
      setNote("");
      setEditId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  const startEdit = (r: Reimbursement) => {
    setEditId(r.id);
    setKind(r.kind);
    setAmount((r.cents / 100).toFixed(2));
    setNote(r.note);
  };
  const submit = () => (editId ? save({ action: "edit_reimbursement", id: editId, kind, amount, note }) : save({ action: "add_reimbursement", assignmentId: line.assignmentId, kind, amount, note }));
  const remove = (r: Reimbursement) => {
    if (!window.confirm(`Remove ${KIND_LABEL[r.kind]} ${money(r.cents)} for ${line.name}?`)) return;
    void save({ action: "remove_reimbursement", id: r.id });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 px-4 py-6" role="dialog" aria-modal="true" aria-label={`Reimbursements for ${line.name}`} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white px-4 py-4 space-y-3 max-h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-heading text-lg font-bold text-[#2C2420]">Reimbursements</h2>
            <p className="text-sm text-[#6B5D52]">
              {line.name} · {dayLabel(line.eventDay)} · {line.eventTitle}
            </p>
          </div>
          <button type="button" onClick={onClose} className={link}>
            Close
          </button>
        </div>
        <p className="text-xs text-[#6B5D52]">Added to their amount in its own column. Not wages.</p>
        {!ready && <p className="text-sm text-[#9A7049]">{REIMBURSEMENTS_NOT_READY}</p>}
        {locked && <p className="text-sm text-[#9A7049]">{LOCKED_MESSAGE}</p>}
        {line.reimbursements.length === 0 ? (
          <p className="text-[15px] text-[#6B5D52]">None yet.</p>
        ) : (
          <ul className="divide-y divide-[#DDD5CC]">
            {line.reimbursements.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-[15px] text-[#2C2420]">
                  {KIND_LABEL[r.kind]} <span className="tabular-nums font-medium">{money(r.cents)}</span> <ReceiptLink r={r} />
                  {r.note && <span className="block text-xs text-[#6B5D52]">{r.note}</span>}
                  {r.receiptId && !locked && <span className="block text-xs text-[#6B5D52]">{FROM_RECEIPT_MESSAGE}</span>}
                </span>
                {!locked && ready && !r.receiptId && (
                  <span className="flex gap-3">
                    <button type="button" className={link} onClick={() => startEdit(r)} disabled={busy}>
                      Edit
                    </button>
                    <button type="button" className={`${link} text-[#A0412D]`} onClick={() => remove(r)} disabled={busy}>
                      Remove
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {!locked && ready && (
          <form
            className="space-y-2 rounded-xl bg-[#FAF6F1] p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <p className="text-sm font-semibold text-[#2C2420]">{editId ? "Change reimbursement" : "Add a reimbursement"}</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm text-[#2C2420]">
                Type
                <select className={`${input} block w-full mt-1`} value={kind} onChange={(e) => setKind(e.target.value as ReimbursementKind)}>
                  {REIMBURSEMENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-[#2C2420]">
                Amount ($)
                <input className={`${input} block w-full mt-1`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="24.00" />
              </label>
            </div>
            <label className="block text-sm text-[#2C2420]">
              Note (optional)
              <input className={`${input} block w-full mt-1`} maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kroger receipt" />
            </label>
            {error && <p className="text-sm text-[#A0412D]">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50">
                {busy ? "Saving..." : editId ? "Save change" : "Add"}
              </button>
              {editId && (
                <button
                  type="button"
                  className="rounded-lg border border-[#DDD5CC] px-4 py-2 text-sm min-h-[44px]"
                  onClick={() => {
                    setEditId(null);
                    setAmount("");
                    setNote("");
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}
        {error && (locked || !ready) && <p className="text-sm text-[#A0412D]">{error}</p>}
      </div>
    </div>
  );
}
