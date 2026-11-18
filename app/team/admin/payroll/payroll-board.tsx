"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hoursText, money, rateText } from "@/lib/team/pay";
import { timeLabel } from "@/lib/team/clock-label";
import { weekStart } from "@/lib/team/timesheet";
import {
  changedText,
  FILTER_LABEL,
  FILTERS,
  filterPeople,
  FIX_HOURS,
  overText,
  PAYROLL_PATH,
  PERIOD_COOKIE,
  periodCookie,
  PROBLEM_TEXT,
  type PayrollFilter,
  type PayrollLine,
  type PayrollPerson,
  type PayrollView,
} from "@/lib/team/payroll";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";
const input = "rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30";

function dayLabel(ymd: string | null): string {
  if (!ymd) return "No date";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/team/admin/payroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Could not save.");
  return data;
}

const FILTER_KEY = "payroll_filter";

// The people cards for a pay period, with the paid checkboxes. Admins only.
export default function PayrollBoard({ view, today }: { view: PayrollView; today: string }) {
  const router = useRouter();
  const [filter, setFilter] = useState<PayrollFilter>("all");
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Remember the period for next time (the page reads it back), and the filter in this browser.
  useEffect(() => {
    document.cookie = `${PERIOD_COOKIE}=${encodeURIComponent(periodCookie(view.period))}; path=${PAYROLL_PATH}; max-age=31536000; samesite=lax`;
    try {
      const f = localStorage.getItem(FILTER_KEY) as PayrollFilter | null;
      if (f && (FILTERS as readonly string[]).includes(f)) setFilter(f);
    } catch {
      /* no storage */
    }
  }, [view.period]);

  const pick = (f: PayrollFilter) => {
    setFilter(f);
    try {
      localStorage.setItem(FILTER_KEY, f);
    } catch {
      /* no storage */
    }
  };

  const run = async (key: string, body: Record<string, unknown>, done?: (data: Record<string, unknown>) => string) => {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      const data = await post(body);
      if (done) setMessage(done(data));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy("");
    }
  };

  const toggle = (l: PayrollLine, name: string) => {
    if (l.paid) {
      if (!window.confirm(`Undo paid for ${name}, ${dayLabel(l.eventDay)}, ${l.eventTitle}?`)) return;
      return run(l.assignmentId, { action: "undo", assignmentId: l.assignmentId });
    }
    return run(l.assignmentId, { action: "mark", assignmentId: l.assignmentId, paidOn, note });
  };

  const markAll = (p: PayrollPerson) => {
    if (!window.confirm(`Mark ${p.payableUnpaid} ${p.payableUnpaid === 1 ? "line" : "lines"} paid for ${p.name}, pay date ${dayLabel(paidOn)}?`)) return;
    return run(`all:${p.staffId}`, { action: "mark_all", staffId: p.staffId, from: view.period.from, to: view.period.to, paidOn, note }, (d) => {
      const skipped = Number(d.skipped ?? 0);
      return `Marked ${d.marked} paid for ${p.name}.${skipped ? ` ${skipped} left: fix hours first.` : ""}`;
    });
  };

  const people = filterPeople(view.people, filter);

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
            <input type="date" className={`${input} block mt-1`} value={paidOn} onChange={(e) => setPaidOn(e.target.value || today)} />
          </label>
          <label className="text-xs text-[#A39585] uppercase tracking-wide grow">
            Note (optional)
            <input type="text" maxLength={120} className={`${input} block mt-1 w-full`} placeholder="Gusto run Nov 20" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <p className="text-xs text-[#6B5D52] mt-2">The pay date and note go on every line you mark paid.</p>
        {error && <p className="text-sm text-[#A0412D] mt-2">{error}</p>}
        {message && <p className="text-sm text-[#55684A] mt-2">{message}</p>}
      </section>

      {view.people.length === 0 ? (
        <p className={`${card} text-[15px] text-[#6B5D52]`}>Nobody worked an event in this period.</p>
      ) : people.length === 0 ? (
        <p className={`${card} text-[15px] text-[#6B5D52]`}>No lines match this filter.</p>
      ) : (
        people.map((p) => (
          <section key={p.staffId} className={card} aria-label={p.name}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-heading text-lg font-bold text-[#2C2420]">{p.name}</h2>
                <p className="text-sm text-[#6B5D52]">
                  {p.role} · {rateText(p.rateCents)}
                </p>
              </div>
              <button
                type="button"
                disabled={!view.ready || p.payableUnpaid === 0 || !!busy}
                onClick={() => markAll(p)}
                className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-40"
              >
                {busy === `all:${p.staffId}` ? "Saving..." : "Mark all paid"}
              </button>
            </div>
            {p.over40.map((w) => (
              <p key={w.week} className="mt-2 rounded-lg bg-[#FFF3DF] px-3 py-2 text-sm text-[#9A7049]">
                <span className="font-bold">40+ hours.</span> {overText(w)}. Overtime is figured by the payroll provider.
              </p>
            ))}
            <ul className="mt-2 divide-y divide-[#DDD5CC]">
              {p.lines.map((l) => (
                <Line key={l.assignmentId} l={l} ready={view.ready} busy={busy === l.assignmentId} disabled={!!busy} onToggle={() => toggle(l, p.name)} />
              ))}
            </ul>
            <dl className="mt-2 border-t-2 border-[#2C2420] pt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm text-[#2C2420] tabular-nums">
              <dt>Total hours</dt>
              <dd className="text-right">{hoursText(p.totals.minutes)} h</dd>
              <dt>Wages</dt>
              <dd className="text-right">{money(p.totals.wagesCents)}</dd>
              <dt>Mileage pay</dt>
              <dd className="text-right">{money(p.totals.mileageCents)}</dd>
              <dt>Tips</dt>
              <dd className="text-right">{money(p.totals.tipsCents)}</dd>
              <dt className="font-bold">Total to pay</dt>
              <dd className="text-right font-bold">{money(p.totals.totalCents)}</dd>
              <dt className="text-[#6B5D52]">Paid</dt>
              <dd className="text-right text-[#6B5D52]">{money(p.totals.paidCents)}</dd>
              <dt className="text-[#6B5D52]">Unpaid</dt>
              <dd className="text-right text-[#6B5D52]">{money(p.totals.unpaidCents)}</dd>
            </dl>
            {filter !== "all" && <p className="text-xs text-[#A39585] mt-1">Totals are for the whole period, every line.</p>}
          </section>
        ))
      )}
    </div>
  );
}

function Line({ l, ready, busy, disabled, onToggle }: { l: PayrollLine; ready: boolean; busy: boolean; disabled: boolean; onToggle: () => void }) {
  const timeHref = `/team/admin/timesheets?week=${weekStart(l.eventDay ?? new Date().toISOString().slice(0, 10))}&event=${encodeURIComponent(l.sessionId)}`;
  const at = (iso: string | null) => (iso ? timeLabel(iso, new Date(0), l.timeZone) : null);
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-[#2C2420] break-words">
            {dayLabel(l.eventDay)} · {l.eventTitle}
          </p>
          <p className="text-sm text-[#2C2420]">
            In {at(l.clockIn) ?? <span className="text-[#A0412D]">missing</span>} · Out {at(l.clockOut) ?? <span className="text-[#A0412D]">missing</span>}
          </p>
          <p className="text-sm text-[#6B5D52] tabular-nums">
            {l.minutes === null ? "No clocked hours" : `${hoursText(l.minutes)} h`} · Wages {money(l.wagesCents)}
            {l.fromEstimate && " (estimate)"} · Mileage {l.mileageMiles} mi, {money(l.mileageCents)} · Tips {l.tipsCents === null ? "not on file" : money(l.tipsCents)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-heading font-bold text-[#2C2420] tabular-nums">{money(l.totalCents)}</p>
          {l.payable || l.paid ? (
            <label className="inline-flex items-center gap-2 text-sm text-[#2C2420] min-h-[44px]">
              <input type="checkbox" className="h-5 w-5 accent-[#55684A]" checked={!!l.paid} disabled={!ready || disabled} onChange={onToggle} aria-label={l.paid ? "Paid. Uncheck to undo" : "Mark paid"} />
              {busy ? "Saving..." : "Paid"}
            </label>
          ) : (
            <Link href={timeHref} className="block text-sm font-medium text-[#A0412D] underline min-h-[44px] pt-2">
              {FIX_HOURS}
            </Link>
          )}
        </div>
      </div>
      {!l.payable && !l.paid && l.problem && <p className="text-xs text-[#A0412D] mt-1">{PROBLEM_TEXT[l.problem]}. Can be marked paid once the hours are in.</p>}
      {l.paid && (
        <p className="text-xs text-[#55684A] mt-1">
          Paid {dayLabel(l.paid.paidOn)} · marked by {l.paid.markedByName} {timeLabel(l.paid.markedAt, new Date(0))}
          {l.paid.note && ` · ${l.paid.note}`}
        </p>
      )}
      {l.changed && (
        <p className="mt-1 rounded-lg bg-[#FBE9E4] px-3 py-2 text-sm text-[#A0412D]">
          <span className="font-bold">Changed after it was marked paid.</span> {changedText(l.changed)}
        </p>
      )}
    </li>
  );
}
