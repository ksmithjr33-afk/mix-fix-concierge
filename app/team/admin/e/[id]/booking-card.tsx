"use client";

import BarbackControl, { type BarbackControlData } from "./barback-control";
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { BookingCardData } from "@/lib/partners/client-view";
const input = "w-full rounded-lg border border-[#DDD5CC] bg-white px-3 py-2 text-[15px] text-[#2C2420]";


/**
 * Who holds the booking, the host, every planner with the Lead marked and how
 * each was linked, the pricing switches, and Add, Replace, and Remove.
 * Admins and managers; every action is checked again on the server.
 */
export default function BookingCard({ sessionId, data, barback }: { sessionId: string; data: BookingCardData; barback?: BarbackControlData | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<null | { mode: "add" | "replace" | "host"; partnerId?: string }>(null);
  const [v, setV] = useState({ name: "", company: "", phone: "", contactEmail: "", lead: false });
  const [honoree, setHonoree] = useState<null | { name: string; phone: string; contactEmail: string }>(null);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/admin/booking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, ...body }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "Could not save.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!data.ready) {
    return (
      <section className="rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3">
        <h2 className="font-heading text-lg font-bold text-[#2C2420]">Booking</h2>
        <p className="text-sm text-[#6B5D52]">The client holds the booking. Planners turn on once the partners database update runs.</p>
        {barback && <BarbackControl sessionId={sessionId} data={barback} />}
      </section>
    );
  }

  const openForm = (mode: "add" | "replace" | "host", partnerId?: string) => {
    setForm({ mode, partnerId });
    setV(mode === "host" && data.host ? { name: data.host.name, company: "", phone: data.host.phone, contactEmail: data.host.contactEmail, lead: false } : { name: "", company: "", phone: "", contactEmail: "", lead: false });
  };

  return (
    <section className="rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3 space-y-3" aria-label="Booking">
      <h2 className="font-heading text-lg font-bold text-[#2C2420]">Booking</h2>
      {data.leadMovedWarning && (
        <p role="alert" className="rounded-xl border border-[#B3261E] bg-[#FDECEA] px-3 py-2 text-sm text-[#8C1D18]">
          {data.leadMovedWarning}
        </p>
      )}
      {data.billing && (
        <div className="text-[15px] text-[#2C2420]">
          <p>
            <span className="text-[#6B5D52]">Billed to: </span>
            {data.billing.billedTo}
          </p>
          {data.billing.eventFor && (
            <p>
              <span className="text-[#6B5D52]">Event for: </span>
              {data.billing.eventFor}
            </p>
          )}
          <p className="text-xs text-[#6B5D52]">The agreement, invoice, payment link, and balance reminders go to the booking holder only, never the host.</p>
        </div>
      )}
      <div className="space-y-1 text-[15px] text-[#2C2420]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[#6B5D52]">Booking holder</span>
          <select
            value={data.holder}
            disabled={busy}
            onChange={(e) => act({ action: "holder", holder: e.target.value })}
            className="rounded-lg border border-[#DDD5CC] bg-white px-2 py-1 text-[15px]"
            aria-label="Booking holder"
          >
            <option value="client">The client</option>
            <option value="planner">A planner</option>
          </select>
        </div>
        {data.setBy && (
          <p className="text-xs text-[#6B5D52]">
            Set by {data.setBy}
            {data.setAt ? `, ${data.setAt}` : ""}
          </p>
        )}
        <p>
          <span className="text-[#6B5D52]">Host </span>
          {data.host ? [data.host.name, data.host.phone, data.host.contactEmail].filter(Boolean).join(" · ") : "None"}{" "}
          <button type="button" onClick={() => openForm("host")} className="text-sm text-[#B5845A] underline">
            {data.host ? "Change" : "Add host"}
          </button>
          {data.host && (
            <button type="button" disabled={busy} onClick={() => act({ action: "host", name: "" })} className="ml-2 text-sm text-[#A0412D] underline">
              Clear
            </button>
          )}
        </p>
      </div>

      <div className="space-y-1">
        <p className="text-sm text-[#6B5D52]">Planners</p>
        {data.planners.length === 0 && <p className="text-[15px] text-[#6B5D52]">None.</p>}
        <ul className="divide-y divide-[#DDD5CC]">
          {data.planners.map((p) => (
            <li key={p.id} className="py-2 text-[15px] text-[#2C2420] space-y-1">
              <p>
                <span className="font-medium">{p.name || p.phone}</span>
                {p.company ? `, ${p.company}` : ""}
                {p.isLead && <span className="ml-2 text-xs font-bold uppercase px-1.5 py-0.5 rounded bg-[#EDE3F5] text-[#5B3F7A]">Lead</span>}
              </p>
              <p className="text-xs text-[#6B5D52]">
                {p.phone} · {p.via}
                {p.linkedBy ? ` by ${p.linkedBy}` : ""}, {p.linkedAt}
              </p>
              <div className="flex flex-wrap gap-3 text-sm">
                {!p.isLead && (
                  <button type="button" disabled={busy} onClick={() => act({ action: "lead", partnerId: p.id })} className="text-[#B5845A] underline">
                    Make Lead
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => openForm("replace", p.id)} className="text-[#B5845A] underline">
                  Replace
                </button>
                <button type="button" disabled={busy} onClick={() => act({ action: "remove", partnerId: p.id })} className="text-[#A0412D] underline">
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => openForm("add")} className="text-sm text-[#B5845A] underline">
          Add a planner
        </button>
      </div>

      {form && (
        <form
          className="rounded-xl border border-[#DDD5CC] bg-white px-3 py-3 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok =
              form.mode === "host"
                ? await act({ action: "host", name: v.name, phone: v.phone, email: v.contactEmail })
                : await act({ action: form.mode, partnerId: form.partnerId, name: v.name, company: v.company, phone: v.phone, email: v.contactEmail, lead: v.lead });
            if (ok) setForm(null);
          }}
        >
          <p className="text-sm font-medium text-[#2C2420]">{form.mode === "host" ? "Host" : form.mode === "replace" ? "Replace with" : "Add a planner"}</p>
          <input className={input} placeholder="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
          {form.mode !== "host" && <input className={input} placeholder="Company (optional)" value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} />}
          <input className={input} type="tel" placeholder={form.mode === "host" ? "Phone (optional, gives the host read only access)" : "Mobile number (matches an existing planner)"} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} required={form.mode !== "host"} />
          <input className={input} type="email" placeholder="Email (optional)" value={v.contactEmail} onChange={(e) => setV({ ...v, contactEmail: e.target.value })} />
          {form.mode === "add" && (
            <label className="flex items-center gap-2 text-sm text-[#2C2420]">
              <input type="checkbox" checked={v.lead} onChange={(e) => setV({ ...v, lead: e.target.checked })} /> Make them the Lead
            </label>
          )}
          {form.mode !== "host" && data.holder === "client" && <p className="text-xs text-[#6B5D52]">The client gets a text that this planner has access, with a link to remove them.</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
              {busy ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={() => setForm(null)} className="text-sm text-[#6B5D52] underline">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="space-y-1 text-[15px] text-[#2C2420]">
        <p className="text-sm text-[#6B5D52]">Pricing switches</p>
        {data.holder === "client" ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={data.switches.planner} disabled={busy || !data.canSetPlannerPricing} onChange={(e) => act({ action: "switch", switch: "planner_can_see_pricing", on: e.target.checked })} />
            Planner can see pricing (total and balance only){!data.canSetPlannerPricing && <span className="text-xs text-[#6B5D52]"> · admins or the client</span>}
          </label>
        ) : (
          <>
            <p>Other planners can see pricing: {data.switches.others ? "On" : "Off"}</p>
            <p>Host can see pricing: {data.switches.host ? "On" : "Off"}</p>
            <p className="text-xs text-[#6B5D52]">Only the Lead planner changes these.</p>
          </>
        )}
      </div>

      <div className="space-y-1 text-[15px] text-[#2C2420]">
        <p className="text-sm text-[#6B5D52]">Surprise</p>
        {!data.surprise.ready ? (
          <p className="text-sm text-[#6B5D52]">Surprise events turn on once the surprise database update runs.</p>
        ) : (
          <>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.surprise.on}
                disabled={busy}
                onChange={(e) => {
                  if (e.target.checked && !data.surprise.name && !data.host?.name) setHonoree({ name: "", phone: "", contactEmail: "" });
                  else act({ action: "surprise", on: e.target.checked, name: data.surprise.name, phone: data.surprise.phone, email: data.surprise.contactEmail });
                }}
              />
              Surprise event
            </label>
            {data.surprise.on && (
              <>
                <p>
                  <span className="text-[#6B5D52]">Guest of honor </span>
                  {[data.surprise.name, data.surprise.phone, data.surprise.contactEmail].filter(Boolean).join(" · ") || "Not named"}{" "}
                  <button type="button" onClick={() => setHonoree({ name: data.surprise.name, phone: data.surprise.phone, contactEmail: data.surprise.contactEmail })} className="text-sm text-[#B5845A] underline">
                    Edit
                  </button>
                </p>
                <p className="text-xs text-[#6B5D52]">
                  {data.surprise.active
                    ? `We never text the guest of honor, the host cannot sign in, and they cannot be added as a planner.${data.surprise.liftsAfter ? ` This lifts after ${data.surprise.liftsAfter}.` : ""}`
                    : "The 30 days after the event have passed, so the block has lifted."}
                </p>
              </>
            )}
            {data.surprise.setBy && (
              <p className="text-xs text-[#6B5D52]">
                Last set by {data.surprise.setBy}
                {data.surprise.setAt ? `, ${data.surprise.setAt}` : ""}
              </p>
            )}
            {honoree && (
              <form
                className="rounded-xl border border-[#DDD5CC] bg-white px-3 py-3 space-y-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await act({ action: "surprise", on: true, name: honoree.name, phone: honoree.phone, email: honoree.contactEmail })) setHonoree(null);
                }}
              >
                <p className="text-sm font-medium text-[#2C2420]">Guest of honor</p>
                <input className={input} placeholder="Name" value={honoree.name} onChange={(e) => setHonoree({ ...honoree, name: e.target.value })} required />
                <input className={input} type="tel" placeholder="Phone (optional, never texted)" value={honoree.phone} onChange={(e) => setHonoree({ ...honoree, phone: e.target.value })} />
                <input className={input} type="email" placeholder="Email (optional, never contacted)" value={honoree.contactEmail} onChange={(e) => setHonoree({ ...honoree, contactEmail: e.target.value })} />
                <p className="text-xs text-[#6B5D52]">Saving their number blocks every text from us to it until 30 days after the event.</p>
                <div className="flex gap-2">
                  <button type="submit" disabled={busy} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
                    {busy ? "Saving..." : "Save"}
                  </button>
                  <button type="button" onClick={() => setHonoree(null)} className="text-sm text-[#6B5D52] underline">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>

      {data.approvals.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm text-[#6B5D52]">Price changes from planners</p>
          <ul className="space-y-1">
            {data.approvals.map((a, i) => (
              <li key={i} className="text-sm text-[#2C2420]">
                {a.at} · {a.askedBy}: {a.summary} · <span className="font-medium">{a.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.activity.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-[#6B5D52]">Partner activity ({data.activity.length})</summary>
          <ul className="mt-2 space-y-1">
            {data.activity.map((a, i) => (
              <li key={i} className="text-[#2C2420]">
                <span className="text-[#6B5D52]">{a.at}</span> {a.who}: {a.what}
              </li>
            ))}
          </ul>
        </details>
      )}
      {barback && <BarbackControl sessionId={sessionId} data={barback} />}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}
