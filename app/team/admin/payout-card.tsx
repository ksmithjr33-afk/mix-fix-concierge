"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CopyButton from "./copy-button";
import { hoursText, mileageText, money, rateSourceText, rateText } from "@/lib/team/pay";
import { reimbursementText } from "@/lib/team/reimbursements";
import { PAYOUT_FLAG_LABEL, diffHours, diffMoney, payoutText, type PayoutRow, type PayoutTotals } from "@/lib/team/payout";

// The payout sheet for one event: admins and managers, on the manager Day of
// tab and on the Time page for that event. Estimate against actual, mileage,
// tips, and what to pay each person.
export default function PayoutCard({ sessionId, title, rows, totals, tipNote = null }: { sessionId: string; title: string; rows: PayoutRow[]; totals: PayoutTotals; tipNote?: string | null }) {
  return (
    <section className="rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3" aria-label="Payout">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Payout</h2>
        {rows.length > 0 && <CopyButton text={payoutText(title, rows, totals)} label="Copy payout" />}
      </div>
      {rows.length === 0 ? (
        <p className="text-[15px] text-[#6B5D52]">Nobody has accepted this event yet.</p>
      ) : (
        <>
          <ul className="divide-y divide-[#DDD5CC]">
            {rows.map((r) => (
              <PayoutLine key={r.assignmentId} sessionId={sessionId} r={r} />
            ))}
          </ul>
          <dl className="mt-2 border-t-2 border-[#2C2420] pt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm text-[#2C2420] tabular-nums">
            <dt>Estimated</dt>
            <dd className="text-right">
              {hoursText(totals.estMinutes)} h · {money(totals.estPayCents)}
            </dd>
            <dt>Actual</dt>
            <dd className="text-right">
              {hoursText(totals.actualMinutes)} h · {money(totals.actualPayCents)}
            </dd>
            <dt>Mileage</dt>
            <dd className="text-right">
              {totals.mileageMiles} mi · {money(totals.mileageCents)}
            </dd>
            <dt>Tips</dt>
            <dd className="text-right">{money(totals.tipsCents)}</dd>
            <dt>Reimbursements</dt>
            <dd className="text-right">{money(totals.reimbursementsCents)}</dd>
            <dt className="font-semibold">Total to pay</dt>
            <dd className="text-right font-heading font-bold">{money(totals.totalCents)}</dd>
          </dl>
          {tipNote && <p className="text-xs text-[#9A7049] mt-1">{tipNote} Tips here stay the gratuity split evenly among the accepted bartenders.</p>}
          {totals.open > 0 && (
            <p className="text-xs text-[#9A7049] mt-1">
              {totals.open} of {totals.people} without actual hours yet: their totals use the estimate.
            </p>
          )}
        </>
      )}
      <p className="text-xs text-[#A39585] mt-1">Mileage is driving miles from home to the event, stored when each person accepted. &ldquo;Straight line&rdquo; means driving miles could not be worked out then: use Recalculate miles.</p>
    </section>
  );
}

function PayoutLine({ sessionId, r }: { sessionId: string; r: PayoutRow }) {
  const [open, setOpen] = useState(false);
  const flagged = r.flags.length > 0;
  return (
    <li className="py-2 space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium text-[15px] text-[#2C2420]">{r.name}</span>
        <span className="font-heading font-bold tabular-nums text-[#2C2420]">
          {money(r.totalCents)}
          {r.fromEstimate && <span className="text-xs font-normal text-[#9A7049]"> estimate</span>}
        </span>
      </div>
      {flagged && (
        <p className="flex flex-wrap gap-1">
          {r.flags.map((f) => (
            <span key={f} className="rounded-full bg-[#F6E3DC] text-[#A0412D] px-2 py-0.5 text-xs font-medium">
              {PAYOUT_FLAG_LABEL[f]}
            </span>
          ))}
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm text-[#2C2420] tabular-nums">
        <dt className="text-[#6B5D52]">Rate</dt>
        <dd>
          {rateText(r.rateCents)} · {rateSourceText({ source: r.rateSource, pkg: r.ratePkg })}
        </dd>
        <dt className="text-[#6B5D52]">Estimated</dt>
        <dd>
          {r.estMinutes === null ? "times not set" : `${hoursText(r.estMinutes)} h · ${money(r.estPayCents ?? 0)}`}
        </dd>
        <dt className="text-[#6B5D52]">Actual</dt>
        <dd>
          {r.actualMinutes === null ? "not clocked out" : `${hoursText(r.actualMinutes)} h · ${money(r.actualPayCents ?? 0)}`}
          {r.approved && <span className="text-xs text-[#55684A]"> · approved</span>}
        </dd>
        {r.diffMinutes !== null && (
          <>
            <dt className="text-[#6B5D52]">Difference</dt>
            <dd className={r.diffMinutes >= 30 ? "text-[#A0412D] font-medium" : ""}>
              {diffHours(r.diffMinutes)} h · {diffMoney(r.diffCents)}
            </dd>
          </>
        )}
        <dt className="text-[#6B5D52]">Mileage</dt>
        <dd className="break-words">
          {r.mileage.state === "paid" ? `${money(r.mileageCents)} · ${mileageText(r.mileage)}` : r.mileage.state === "no_address" ? "No home address on file" : mileageText(r.mileage)}
          {r.mileage.state === "paid" && r.mileage.note && <span className="block text-xs text-[#6B5D52]">Note: {r.mileage.note}</span>}
        </dd>
        <dt className="text-[#6B5D52]">Tips</dt>
        <dd>{r.tipsCents === null ? "not on file yet" : money(r.tipsCents)}</dd>
        {r.reimbursements.length > 0 && (
          <>
            <dt className="text-[#6B5D52]">Reimbursed</dt>
            <dd className="break-words">{r.reimbursements.map(reimbursementText).join(", ")}</dd>
          </>
        )}
      </dl>
      <div className="flex flex-wrap items-center gap-x-4">
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-h-[44px] text-sm text-[#B5845A] underline">
          {open ? "Close" : "Adjust mileage"}
        </button>
        <RecalculateMiles sessionId={sessionId} staffId={r.staffId} />
      </div>
      {open && <AdjustMileage sessionId={sessionId} staffId={r.staffId} done={() => setOpen(false)} />}
    </li>
  );
}

function RecalculateMiles({ sessionId, staffId }: { sessionId: string; staffId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const run = async () => {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/team/admin/mileage/recalculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, staffId }),
    }).catch(() => null);
    const data = ((await res?.json().catch(() => ({}))) ?? {}) as { error?: string; miles?: number | null; source?: string };
    setBusy(false);
    if (!res?.ok) {
      setMsg(data.error ?? "Could not recalculate. Try again.");
      return;
    }
    setMsg(data.miles == null ? "No home address on the map." : `${data.miles} mi one way, ${data.source === "driving" ? "driving" : "straight line"}.`);
    router.refresh();
  };
  return (
    <span className="text-sm">
      <button type="button" disabled={busy} onClick={run} className="min-h-[44px] text-[#B5845A] underline disabled:opacity-50">
        {busy ? "Recalculating…" : "Recalculate miles"}
      </button>
      {msg && <span className="ml-2 text-xs text-[#6B5D52]" role="status">{msg}</span>}
    </span>
  );
}

function AdjustMileage({ sessionId, staffId, done }: { sessionId: string; staffId: string; done: () => void }) {
  const router = useRouter();
  const [miles, setMiles] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = "w-full rounded-lg border border-[#DDD5CC] px-3 py-2 text-[16px]";
  const save = async (clear: boolean) => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/team/admin/mileage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clear ? { sessionId, staffId } : { sessionId, staffId, miles, amount, note }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(((await res?.json().catch(() => ({}))) as { error?: string })?.error ?? "Could not save. Try again.");
      return;
    }
    done();
    router.refresh();
  };
  return (
    <div className="rounded-xl bg-[#FAF6F1] p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm text-[#2C2420]">
          One way miles
          <input className={input} inputMode="decimal" value={miles} onChange={(e) => setMiles(e.target.value)} />
        </label>
        <label className="text-sm text-[#2C2420]">
          Or amount ($)
          <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      </div>
      <label className="block text-sm text-[#2C2420]">
        Note
        <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it changed" />
      </label>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => save(false)} className="rounded-lg bg-[#B5845A] text-white px-3 py-2 text-sm font-medium disabled:opacity-50">
          Save
        </button>
        <button type="button" disabled={busy} onClick={() => save(true)} className="rounded-lg border border-[#DDD5CC] px-3 py-2 text-sm">
          Remove adjustment
        </button>
      </div>
    </div>
  );
}
