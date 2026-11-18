"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { money } from "@/lib/team/pay";
import { costsTitle, profitTitle, type Payment } from "@/lib/team/business";
import type { EventBusinessView } from "@/lib/team/business-db";

// The Business tab: admins only (the server never builds it for anyone else).
// A filled in estimate for every event: profit at the top, then revenue and
// payments, then costs. The app stores no card information: a payment is an
// amount, a date, and an optional note.

const card = "rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3";
const input = "w-full rounded-lg border border-[#DDD5CC] px-3 py-2 text-[16px]";
const btn = "rounded-lg bg-[#B5845A] text-white px-3 py-2 text-sm font-medium disabled:opacity-50";
const ghost = "rounded-lg border border-[#DDD5CC] px-3 py-2 text-sm disabled:opacity-50";
const link = "min-h-[44px] text-sm text-[#B5845A] underline disabled:opacity-50";
const warn = "text-[#A0412D]";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const dateText = (ymd: string | null) => {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
};

function useSave(sessionId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/team/admin/business/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, ...body }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(((await res?.json().catch(() => ({}))) as { error?: string })?.error ?? "Could not save. Try again.");
      return false;
    }
    router.refresh();
    return true;
  };
  return { busy, error, save };
}

function FixLink({ href, children }: { href: string; children: React.ReactNode }) {
  return href.startsWith("#") ? (
    <a href={href} className="text-[#B5845A] underline">
      {children}
    </a>
  ) : (
    <Link href={href} className="text-[#B5845A] underline">
      {children}
    </Link>
  );
}

export default function BusinessTab({ view }: { view: EventBusinessView }) {
  const b = view.business;
  const r = b.revenue;
  return (
    <>
      <section className={card} aria-label="Profit">
        <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">{profitTitle(b)}</h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[15px] text-[#2C2420] tabular-nums">
          <dt>Revenue</dt>
          <dd className="text-right">{r.totalCents === null ? "no booked total" : money(r.totalCents)}</dd>
          <dt>{costsTitle(b)}</dt>
          <dd className="text-right">{money(b.costCents)}</dd>
          <dt className="font-semibold">{profitTitle(b)}</dt>
          <dd className="text-right font-heading text-xl font-bold">{b.profitCents === null ? "—" : money(b.profitCents)}</dd>
          <dt>Margin</dt>
          <dd className="text-right">{b.marginPct === null ? "—" : `${b.marginPct}%`}</dd>
        </dl>
        {!b.complete && (
          <ul className="mt-2 space-y-1 text-[15px] text-[#9A7049]">
            {b.missing.map((m) => (
              <li key={m.key}>
                Profit needs one thing: <FixLink href={m.href}>{m.text}</FixLink>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card} aria-label="Revenue">
        <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">Revenue</h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[15px] text-[#2C2420] tabular-nums">
          <dt>Booked total</dt>
          <dd className="text-right font-semibold">{r.totalCents === null ? "no booked total" : money(r.totalCents)}</dd>
          <dt className="text-[#6B5D52]">Gratuity inside it</dt>
          <dd className="text-right">{money(r.gratuityCents ?? 0)}</dd>
        </dl>
        {r.noGratuity && <p className="text-xs text-[#9A7049] mt-0.5">No gratuity on file. Tips paid out will show $0 until it is entered.</p>}
        {r.totalCents === null && <TotalForm sessionId={view.sessionId} pending={view.pricePending} askGratuity={r.gratuityCents === null} />}

        <h3 className="text-sm font-semibold text-[#2C2420] mt-3">Payments</h3>
        <Deposit sessionId={view.sessionId} cents={r.depositPaidCents} on={r.depositPaidOn} edited={r.depositEdited} />
        <ul className="divide-y divide-[#EFE8E0]">
          {r.payments.map((p) => (
            <PaymentLine key={p.id} sessionId={view.sessionId} p={p} />
          ))}
        </ul>
        <PaymentActions sessionId={view.sessionId} canPayInFull={r.totalCents !== null && (r.balanceCents ?? 0) > 0} remaining={r.balanceCents} />

        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[15px] text-[#2C2420] tabular-nums border-t border-[#DDD5CC] pt-2">
          <dt className="font-semibold">Remaining balance</dt>
          <dd className={`text-right font-semibold ${r.overpaidCents ? warn : ""}`}>{r.overpaidCents ? `Overpaid by ${money(r.overpaidCents)}` : r.balanceCents === null ? "no booked total" : money(r.balanceCents)}</dd>
          <dt>Balance due date</dt>
          <dd className="text-right">{dateText(r.balanceDue) || "no event date"}</dd>
          <dt>Status</dt>
          <dd className={`text-right ${r.paid === "overdue" ? warn : ""}`}>{r.status}</dd>
        </dl>
      </section>

      <section className={card} aria-label="Costs">
        <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">{costsTitle(b)}</h2>
        <ul className="divide-y divide-[#DDD5CC]">
          {b.costs.map((c) => (
            <li key={c.key} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="text-[15px] text-[#2C2420]">
                {c.label}
                {c.note && <span className="block text-xs text-[#6B5D52]">{c.href ? <FixLink href={c.href}>{c.note}</FixLink> : c.note}</span>}
              </span>
              <span className={`tabular-nums ${c.cents === null ? "text-sm text-[#9A7049]" : "text-[#2C2420]"}`}>{c.cents === null ? (c.key === "mileage" ? "after the event" : "—") : money(c.cents)}</span>
            </li>
          ))}
          <li className="flex items-baseline justify-between gap-3 py-1.5 font-semibold">
            <span>{costsTitle(b)}</span>
            <span className="tabular-nums">{money(b.costCents)}</span>
          </li>
        </ul>
        <SuppliesForm sessionId={view.sessionId} manual={view.manualSupplies} />
        {!view.manualSupplies && view.supplies && view.supplies.unmatched.length > 0 && (
          <div className="mt-2">
            <p className="text-sm font-medium text-[#2C2420]">No cost in the catalog yet</p>
            <ul className="text-sm text-[#6B5D52] list-disc pl-5">
              {view.supplies.unmatched.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        )}
        <OtherCosts sessionId={view.sessionId} lines={view.other} />
      </section>
    </>
  );
}

function Deposit({ sessionId, cents, on, edited }: { sessionId: string; cents: number; on: string | null; edited: boolean }) {
  const { busy, error, save } = useSave(sessionId);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((cents / 100).toFixed(2));
  const [date, setDate] = useState(on ?? "");
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[15px] tabular-nums">
        <span>
          Deposit paid{on ? <span className="text-sm text-[#6B5D52]"> · {dateText(on)}</span> : null}
          {!open && (
            <button type="button" className={`${link} ml-3`} onClick={() => setOpen(true)}>
              Edit deposit
            </button>
          )}
        </span>
        <span>{money(cents)}</span>
      </div>
      {open && (
        <div className="mt-1 rounded-xl bg-[#FAF6F1] p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              Deposit ($)
              <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="text-sm">
              Date paid
              <input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          {error && <p className={`text-sm ${warn}`}>{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={busy || !amount.trim()} onClick={async () => (await save({ action: "deposit", amount, date })) && setOpen(false)}>
              Save
            </button>
            {edited && (
              <button type="button" className={ghost} disabled={busy} onClick={async () => (await save({ action: "deposit", amount: "" })) && setOpen(false)}>
                Back to the default
              </button>
            )}
            <button type="button" className={ghost} disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentFields({ amount, date, note, set }: { amount: string; date: string; note: string; set: (k: "amount" | "date" | "note", v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="text-sm">
        Amount ($)
        <input className={input} inputMode="decimal" value={amount} onChange={(e) => set("amount", e.target.value)} />
      </label>
      <label className="text-sm">
        Date
        <input className={input} type="date" value={date} onChange={(e) => set("date", e.target.value)} />
      </label>
      <label className="text-sm col-span-2">
        Note
        <input className={input} value={note} maxLength={120} onChange={(e) => set("note", e.target.value)} placeholder="optional, like Zelle or second payment" />
      </label>
    </div>
  );
}

function PaymentLine({ sessionId, p }: { sessionId: string; p: Payment }) {
  const { busy, error, save } = useSave(sessionId);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ amount: (p.cents / 100).toFixed(2), date: p.paidOn ?? today(), note: p.note });
  if (editing)
    return (
      <li className="py-2 space-y-2">
        <PaymentFields {...f} set={(k, v) => setF({ ...f, [k]: v })} />
        {error && <p className={`text-sm ${warn}`}>{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} disabled={busy} onClick={async () => (await save({ action: "edit_payment", id: p.id, ...f })) && setEditing(false)}>
            Save
          </button>
          <button type="button" className={ghost} disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </li>
    );
  return (
    <li className="py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[15px] tabular-nums">
        <span>
          Payment<span className="text-sm text-[#6B5D52]">{p.paidOn ? ` · ${dateText(p.paidOn)}` : ""}</span>
        </span>
        <span>{money(p.cents)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-[#6B5D52]">
        {p.note && <span>{p.note}</span>}
        {p.recordedBy && <span>Recorded by {p.recordedBy}</span>}
        <button type="button" className={link} disabled={busy} onClick={() => setEditing(true)}>
          Edit
        </button>
        <button
          type="button"
          className={`${link} !text-[#A0412D]`}
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete the ${money(p.cents)} payment?`)) void save({ action: "delete_payment", id: p.id });
          }}
        >
          Delete
        </button>
      </div>
      {error && <p className={`text-sm ${warn}`}>{error}</p>}
    </li>
  );
}

function PaymentActions({ sessionId, canPayInFull, remaining }: { sessionId: string; canPayInFull: boolean; remaining: number | null }) {
  const { busy, error, save } = useSave(sessionId);
  const [open, setOpen] = useState(false);
  const blank = () => ({ amount: "", date: today(), note: "" });
  const [f, setF] = useState(blank);
  return (
    <div className="mt-1">
      {!open ? (
        <div className="flex flex-wrap gap-x-4">
          <button
            type="button"
            className={link}
            onClick={() => {
              setF(blank());
              setOpen(true);
            }}
          >
            Record a payment
          </button>
          {canPayInFull && (
            <button
              type="button"
              className={link}
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Record one payment of ${money(remaining ?? 0)} for the remaining balance, dated today?`)) void save({ action: "paid_in_full", date: today() });
              }}
            >
              Mark paid in full
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-[#FAF6F1] p-3 space-y-2">
          <p className="text-sm font-medium">Record a payment</p>
          <PaymentFields {...f} set={(k, v) => setF({ ...f, [k]: v })} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={busy || !f.amount.trim()} onClick={async () => (await save({ action: "add_payment", ...f })) && setOpen(false)}>
              Save payment
            </button>
            <button type="button" className={ghost} disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className={`text-sm ${warn}`}>{error}</p>}
    </div>
  );
}

function TotalForm({ sessionId, pending, askGratuity }: { sessionId: string; pending: boolean; askGratuity: boolean }) {
  const { busy, error, save } = useSave(sessionId);
  const [total, setTotal] = useState("");
  const [grat, setGrat] = useState("");
  return (
    <div id="total" className="mt-3 rounded-xl bg-[#FAF6F1] p-3 space-y-2 scroll-mt-24">
      <p className="text-sm text-[#2C2420]">{pending ? "This event is price pending. Entering the total clears it and sends the normal change order." : "No booked total is on file. Enter it here."}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">
          Total ($)
          <input className={input} inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
        </label>
        {askGratuity && (
          <label className="text-sm">
            Gratuity inside it ($)
            <input className={input} inputMode="decimal" value={grat} onChange={(e) => setGrat(e.target.value)} placeholder="optional" />
          </label>
        )}
      </div>
      {error && <p className={`text-sm ${warn}`}>{error}</p>}
      <button type="button" className={btn} disabled={busy || !total.trim()} onClick={() => save({ action: "total", total, gratuity: grat })}>
        Save total
      </button>
    </div>
  );
}

function SuppliesForm({ sessionId, manual }: { sessionId: string; manual: boolean }) {
  const { busy, error, save } = useSave(sessionId);
  const [amount, setAmount] = useState("");
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="text-sm flex-1 min-w-[10rem]">
        Supplies for this event, by hand ($)
        <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={manual ? "entered by hand" : "optional"} />
      </label>
      <button type="button" className={btn} disabled={busy || !amount.trim()} onClick={async () => (await save({ action: "supplies", amount })) && setAmount("")}>
        Save
      </button>
      {manual && (
        <button type="button" className={ghost} disabled={busy} onClick={() => save({ action: "supplies", amount: "" })}>
          Use the estimate
        </button>
      )}
      {error && <p className={`w-full text-sm ${warn}`}>{error}</p>}
    </div>
  );
}

function OtherCosts({ sessionId, lines }: { sessionId: string; lines: { id: string; label: string; cents: number }[] }) {
  const { busy, error, save } = useSave(sessionId);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <div className="mt-3">
      <p className="text-sm font-medium text-[#2C2420]">Other costs</p>
      {lines.length > 0 && (
        <ul className="text-[15px] divide-y divide-[#EFE8E0]">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 py-1">
              <span>{l.label}</span>
              <span className="flex items-center gap-2 tabular-nums">
                {money(l.cents)}
                <button type="button" className={`${link} !text-[#A0412D]`} disabled={busy} onClick={() => save({ action: "remove_cost", id: l.id })}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1 grid grid-cols-[1fr_7rem_auto] gap-2 items-end">
        <label className="text-sm">
          Label
          <input className={input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Glass rental" />
        </label>
        <label className="text-sm">
          Amount ($)
          <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <button
          type="button"
          className={btn}
          disabled={busy || !label.trim() || !amount.trim()}
          onClick={async () => {
            if (await save({ action: "add_cost", label, amount })) {
              setLabel("");
              setAmount("");
            }
          }}
        >
          Add
        </button>
      </div>
      {error && <p className={`text-sm ${warn}`}>{error}</p>}
    </div>
  );
}
