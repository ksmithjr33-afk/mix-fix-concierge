"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/team/pay";
import { PAID_LABEL } from "@/lib/team/business";
import type { EventBusinessView } from "@/lib/team/business-db";

// The Business tab: admins only (the server never builds it for anyone else).
// Revenue, costs, and profit for this event, with admin entry for payments,
// supplies, a missing total, and other costs.

const card = "rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3";
const input = "w-full rounded-lg border border-[#DDD5CC] px-3 py-2 text-[16px]";
const btn = "rounded-lg bg-[#B5845A] text-white px-3 py-2 text-sm font-medium disabled:opacity-50";
const cents = (c: number | null) => (c === null ? "not on file" : money(c));
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

export default function BusinessTab({ view }: { view: EventBusinessView }) {
  const b = view.business;
  const r = b.revenue;
  return (
    <>
      <section className={card} aria-label="Profit">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-heading text-base font-bold text-[#2C2420]">{b.mode} profit</h2>
          {b.complete ? (
            <span className="font-heading text-xl font-bold tabular-nums text-[#2C2420]">{money(b.profitCents ?? 0)}</span>
          ) : (
            <span className="rounded-full bg-[#FFF8EC] border border-[#E3C9A0] px-2 py-0.5 text-sm font-medium text-[#9A7049]">Incomplete</span>
          )}
        </div>
        {b.complete && b.marginPct !== null && <p className="text-sm text-[#6B5D52]">{b.marginPct}% margin on {money(r.totalCents ?? 0)}</p>}
        {!b.complete && (
          <>
            <p className="text-sm text-[#6B5D52] mt-1">Profit shows once these are on file:</p>
            <ul className="list-disc pl-5 text-[15px] text-[#2C2420]">
              {b.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className={card} aria-label="Revenue">
        <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">Revenue</h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[15px] text-[#2C2420] tabular-nums">
          <dt>Booked total</dt>
          <dd className="text-right font-semibold">{cents(r.totalCents)}</dd>
          <dt className="text-[#6B5D52]">Gratuity inside it</dt>
          <dd className="text-right">{cents(r.gratuityCents)}</dd>
          <dt>Deposit paid</dt>
          <dd className="text-right">{r.depositPaidCents === null ? "not recorded" : `${money(r.depositPaidCents)}${r.depositPaidOn ? `, ${dateText(r.depositPaidOn)}` : ""}`}</dd>
          <dt>Balance paid</dt>
          <dd className="text-right">{r.balancePaidCents === null ? "not recorded" : `${money(r.balancePaidCents)}${r.balancePaidOn ? `, ${dateText(r.balancePaidOn)}` : ""}`}</dd>
          <dt>Balance</dt>
          <dd className="text-right">{cents(r.balanceCents)}</dd>
          <dt>Balance due</dt>
          <dd className="text-right">{dateText(r.balanceDue) || "no event date"}</dd>
          <dt>Status</dt>
          <dd className="text-right">{PAID_LABEL[r.paid]}</dd>
        </dl>
        {r.totalCents === null && <TotalForm sessionId={view.sessionId} pending={view.pricePending} askGratuity={r.gratuityCents === null} />}
        <PaymentForm sessionId={view.sessionId} action="deposit" label="Deposit paid" suggest={view.bookedDepositCents} />
        <PaymentForm sessionId={view.sessionId} action="balance" label="Balance paid" suggest={r.balanceCents} />
      </section>

      <section className={card} aria-label="Costs">
        <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">{b.mode} costs</h2>
        <ul className="divide-y divide-[#DDD5CC]">
          {b.costs.map((c) => (
            <li key={c.key} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="text-[15px] text-[#2C2420]">
                {c.label}
                {c.note && <span className="block text-xs text-[#6B5D52]">{c.note}</span>}
              </span>
              <span className={`tabular-nums ${c.cents === null ? "text-sm text-[#9A7049]" : "text-[#2C2420]"}`}>{cents(c.cents)}</span>
            </li>
          ))}
          <li className="flex items-baseline justify-between gap-3 py-1.5 font-semibold">
            <span>Costs on file</span>
            <span className="tabular-nums">{money(b.costCents)}</span>
          </li>
        </ul>
        <SuppliesForm sessionId={view.sessionId} manual={view.manualSupplies} />
        {view.supplies && view.supplies.unmatched.length > 0 && (
          <div className="mt-2">
            <p className="text-sm font-medium text-[#2C2420]">No cost yet</p>
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

function TotalForm({ sessionId, pending, askGratuity }: { sessionId: string; pending: boolean; askGratuity: boolean }) {
  const { busy, error, save } = useSave(sessionId);
  const [total, setTotal] = useState("");
  const [grat, setGrat] = useState("");
  return (
    <div className="mt-3 rounded-xl bg-[#FAF6F1] p-3 space-y-2">
      <p className="text-sm text-[#2C2420]">{pending ? "This event is price pending. Entering the total clears it and sends the normal change order." : "No total is on file. Enter it here."}</p>
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
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <button type="button" className={btn} disabled={busy || !total.trim()} onClick={() => save({ action: "total", total, gratuity: grat })}>
        Save total
      </button>
    </div>
  );
}

function PaymentForm({ sessionId, action, label, suggest }: { sessionId: string; action: "deposit" | "balance"; label: string; suggest: number | null }) {
  const { busy, error, save } = useSave(sessionId);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(suggest ? (suggest / 100).toFixed(2) : "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  if (!open)
    return (
      <button type="button" className="min-h-[44px] mr-4 text-sm text-[#B5845A] underline" onClick={() => setOpen(true)}>
        Record {label.toLowerCase()}
      </button>
    );
  return (
    <div className="mt-2 rounded-xl bg-[#FAF6F1] p-3 space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">
          Amount ($)
          <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="text-sm">
          Date
          <input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={busy} onClick={async () => (await save({ action, amount, date })) && setOpen(false)}>
          Save
        </button>
        <button type="button" className="rounded-lg border border-[#DDD5CC] px-3 py-2 text-sm" disabled={busy} onClick={async () => (await save({ action, amount: "" })) && setOpen(false)}>
          Clear
        </button>
      </div>
    </div>
  );
}

function SuppliesForm({ sessionId, manual }: { sessionId: string; manual: boolean }) {
  const { busy, error, save } = useSave(sessionId);
  const [amount, setAmount] = useState("");
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="text-sm flex-1 min-w-[10rem]">
        Supplies for this event ($)
        <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={manual ? "entered" : "uses the cost catalog"} />
      </label>
      <button type="button" className={btn} disabled={busy || !amount.trim()} onClick={async () => (await save({ action: "supplies", amount })) && setAmount("")}>
        Save
      </button>
      {manual && (
        <button type="button" className="rounded-lg border border-[#DDD5CC] px-3 py-2 text-sm" disabled={busy} onClick={() => save({ action: "supplies", amount: "" })}>
          Use the catalog
        </button>
      )}
      {error && <p className="w-full text-sm text-[#A0412D]">{error}</p>}
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
                <button type="button" className="min-h-[44px] text-sm text-[#A0412D] underline" disabled={busy} onClick={() => save({ action: "remove_cost", id: l.id })}>
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
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </div>
  );
}
