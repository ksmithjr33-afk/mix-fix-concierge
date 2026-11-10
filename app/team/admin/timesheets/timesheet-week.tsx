"use client";

import { useMemo, useState } from "react";
import type { TimesheetRow } from "@/lib/team/timesheet";
import { OWN_APPROVE_MESSAGE, staffTotals, toChicagoLocal, weekApproval } from "@/lib/team/timesheet";
import { FLAG_LABELS, formatWorked, type PunchFlag } from "@/lib/team/clock";
import { timeLabel } from "@/lib/team/clock-label";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";
const input =
  "w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30";

function dayLabel(ymd: string | null): string {
  if (!ymd) return "Date to be confirmed";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

async function post(body: Record<string, unknown>): Promise<{ rows: TimesheetRow[]; message?: string }> {
  const res = await fetch("/api/team/admin/timesheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Could not save.");
  return data;
}

function EditForm({ row, onSaved, onCancel }: { row: TimesheetRow; onSaved: (rows: TimesheetRow[]) => void; onCancel: () => void }) {
  const [type, setType] = useState<"in" | "out">(!row.clockIn ? "in" : !row.clockOut ? "out" : "in");
  const existing = type === "in" ? row.clockIn : row.clockOut;
  const [at, setAt] = useState(toChicagoLocal(existing?.at ?? null));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = (t: "in" | "out") => {
    setType(t);
    setAt(toChicagoLocal((t === "in" ? row.clockIn : row.clockOut)?.at ?? null));
  };

  return (
    <div className="mt-2 rounded-xl border border-[#E3C9A0] bg-[#FFF8EC] px-3 py-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {(["in", "out"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => pick(t)}
            className={`rounded-lg py-2 text-sm font-medium border ${type === t ? "bg-[#2C2420] text-white border-[#2C2420]" : "border-[#A39585] text-[#6B5D52]"}`}
          >
            {(t === "in" ? row.clockIn : row.clockOut) ? "Correct" : "Add"} clock {t}
          </button>
        ))}
      </div>
      <label className="block text-xs text-[#A39585] uppercase tracking-wide">
        Clock {type} time (Dallas time)
        <input type="datetime-local" className={`${input} mt-1`} value={at} onChange={(e) => setAt(e.target.value)} />
      </label>
      <label className="block text-xs text-[#A39585] uppercase tracking-wide">
        Reason (required)
        <textarea rows={2} maxLength={500} className={`${input} mt-1 resize-none`} placeholder="Forgot to clock out, left at 11:15" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {existing && <p className="text-xs text-[#6B5D52]">Was {timeLabel(existing.at)}. The original time stays in the edit history.</p>}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || reason.trim().length < 3 || !at}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              onSaved((await post({ action: "edit", assignmentId: row.assignmentId, type, at, reason })).rows);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save.");
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-[#6B5D52] underline px-2">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Row({ row, meId, onRows }: { row: TimesheetRow; meId: string; onRows: (rows: TimesheetRow[], message?: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const own = row.staffId === meId;

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-[#2C2420]">
            {row.staffName}
            {own && <span className="text-xs text-[#A39585]"> (you)</span>}
          </p>
          <p className="text-sm text-[#6B5D52] break-words">
            {dayLabel(row.eventDay)} · {row.eventTitle}
            {row.scheduledStart && ` · scheduled ${row.scheduledStart}${row.scheduledEnd ? ` to ${row.scheduledEnd}` : ""}`}
          </p>
        </div>
        <span className="shrink-0 text-right">
          <span className="block font-heading font-bold text-[#2C2420] tabular-nums">{row.minutes === null ? "--" : formatWorked(row.minutes)}</span>
          {row.approved ? (
            <span className="block text-[11px] font-bold uppercase tracking-wide text-[#55684A]">Approved</span>
          ) : (
            <span className="block text-[11px] font-bold uppercase tracking-wide text-[#9A7049]">Not approved</span>
          )}
        </span>
      </div>
      <p className="text-sm text-[#2C2420] mt-1">
        In {row.clockIn ? timeLabel(row.clockIn.at) : <span className="text-[#A0412D]">missing</span>} · Out{" "}
        {row.clockOut ? timeLabel(row.clockOut.at) : <span className="text-[#A0412D]">missing</span>}
      </p>
      {row.flags.length > 0 && (
        <p className="flex flex-wrap gap-1 mt-1">
          {row.flags.map((f) => (
            <span key={f} className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-[#FFF3DF] text-[#9A7049]">
              {FLAG_LABELS[f as PunchFlag] ?? f}
            </span>
          ))}
        </p>
      )}
      {row.approved && (
        <p className="text-xs text-[#6B5D52] mt-1">
          Approved by {row.approved.byName} {timeLabel(row.approved.at)}. Locked.
        </p>
      )}
      {row.edits.length > 0 && (
        <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-xs text-[#6B5D52] underline mt-1">
          {showHistory ? "Hide edit history" : `Edit history (${row.edits.length})`}
        </button>
      )}
      {showHistory && (
        <ul className="mt-1 space-y-1">
          {row.edits.map((e, i) => (
            <li key={i} className="text-xs text-[#6B5D52]">
              {e.byName} {e.action === "add" ? "added" : "corrected"} clock {e.type}
              {e.oldAt ? ` from ${timeLabel(e.oldAt)}` : ""} to {timeLabel(e.newAt)}: &ldquo;{e.reason}&rdquo; ({timeLabel(e.at)})
            </li>
          ))}
        </ul>
      )}
      {!row.approved &&
        (own ? (
          <p className="text-xs text-[#9A7049] mt-2">This is your own time. You cannot edit or approve it. Ask another admin.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-4 mt-2">
            {!editing && (
              <button type="button" onClick={() => setEditing(true)} className="text-sm text-[#B5845A] underline">
                {row.clockIn && row.clockOut ? "Correct a punch" : "Add a punch"}
              </button>
            )}
            <button
              type="button"
              disabled={busy || !row.clockIn || !row.clockOut}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const r = await post({ action: "approve", assignmentIds: [row.assignmentId] });
                  onRows(r.rows);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not save.");
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-lg bg-[#8B9E7E] text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            >
              {busy ? "Approving..." : "Approve"}
            </button>
          </div>
        ))}
      {editing && (
        <EditForm
          row={row}
          onCancel={() => setEditing(false)}
          onSaved={(rows) => {
            setEditing(false);
            onRows(rows);
          }}
        />
      )}
      {error && <p className="text-sm text-[#A0412D] mt-1">{error}</p>}
    </li>
  );
}

export default function TimesheetWeek({ initial, meId, from, to }: { initial: TimesheetRow[]; meId: string; from: string; to: string }) {
  const [rows, setRows] = useState(initial);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState({ from, to });
  const totals = useMemo(() => staffTotals(rows), [rows]);
  const plan = useMemo(() => weekApproval(meId, rows), [rows, meId]);
  const ownWaiting = plan.skipped.filter((s) => s.reason === OWN_APPROVE_MESSAGE).length;

  const merge = (updated: TimesheetRow[], msg?: string) => {
    setRows((list) => list.map((r) => updated.find((u) => u.assignmentId === r.assignmentId) ?? r));
    if (msg) setMessage(msg);
  };

  return (
    <div className="space-y-3">
      {totals.length > 0 && (
        <section className={card}>
          <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">Hours this week</h2>
          <ul className="divide-y divide-[#DDD5CC]">
            {totals.map((t) => (
              <li key={t.staffId} className="flex justify-between py-1.5 text-[15px] text-[#2C2420]">
                <span>{t.staffName}</span>
                <span className="tabular-nums">
                  {formatWorked(t.minutes)}
                  {t.open > 0 && <span className="text-xs text-[#A0412D]"> · {t.open} incomplete</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-heading text-base font-bold text-[#2C2420]">Rows</h2>
          <button
            type="button"
            disabled={busy || plan.approve.length === 0}
            onClick={async () => {
              setBusy(true);
              setMessage("");
              try {
                const r = await post({ action: "approve", assignmentIds: rows.filter((x) => !x.approved).map((x) => x.assignmentId) });
                merge(r.rows, r.message);
              } catch (err) {
                setMessage(err instanceof Error ? err.message : "Could not save.");
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-lg bg-[#8B9E7E] text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            {busy ? "Approving..." : `Approve week (${plan.approve.length})`}
          </button>
        </div>
        {ownWaiting > 0 && (
          <p className="text-xs text-[#9A7049] mt-1">
            {ownWaiting === 1 ? "1 row is your own time" : `${ownWaiting} rows are your own time`}. You cannot approve your own time. Ask another admin to approve {ownWaiting === 1 ? "it" : "them"}.
          </p>
        )}
        {message && <p className="text-sm text-[#2C2420] mt-2">{message}</p>}
        {rows.length === 0 ? (
          <p className="text-[15px] text-[#6B5D52] py-2">No staffed events this week.</p>
        ) : (
          <ul className="divide-y divide-[#DDD5CC]">
            {rows.map((r) => (
              <Row key={r.assignmentId} row={r} meId={meId} onRows={merge} />
            ))}
          </ul>
        )}
        <p className="text-xs text-[#A39585] mt-2">Nobody can edit or approve their own time. Edits need a reason, and approved rows lock.</p>
      </section>

      <section className={card}>
        <h2 className="font-heading text-base font-bold text-[#2C2420] mb-2">Export CSV</h2>
        <form action="/api/team/admin/timesheets/export" method="get" className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-[#A39585] uppercase tracking-wide">
            From
            <input type="date" name="from" className={`${input} mt-1`} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} required />
          </label>
          <label className="text-xs text-[#A39585] uppercase tracking-wide">
            To
            <input type="date" name="to" className={`${input} mt-1`} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} required />
          </label>
          <button type="submit" className="rounded-xl bg-[#B5845A] text-white px-4 py-2.5 font-medium">
            Download
          </button>
        </form>
        <p className="text-xs text-[#A39585] mt-2">By event date. Times are Dallas time. Hours are decimal, so 5h 30m is 5.50.</p>
      </section>
    </div>
  );
}
