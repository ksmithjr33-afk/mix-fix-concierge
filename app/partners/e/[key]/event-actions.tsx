"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input = "w-full rounded-xl border border-[#DDD5CC] bg-[#E8DDD5] px-3 py-2 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30";

async function post(url: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.error ?? "Could not save.";
  } catch {
    return "Could not reach the server. Try again.";
  }
}

/** Price changes waiting for the Lead (who holds the booking) to approve or decline. */
export function Approvals({ eventKey, items }: { eventKey: string; items: { id: string; summary: string; priceText: string; askedBy: string; status: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const pending = items.filter((i) => i.status === "pending");
  if (pending.length === 0) return null;
  const decide = async (id: string, yes: boolean) => {
    setBusy(id);
    setError("");
    const err = await post("/api/partners/approvals", { key: eventKey, id, yes });
    setBusy("");
    if (err) setError(err);
    router.refresh();
  };
  return (
    <section className="rounded-2xl border-2 border-[#E3C9A0] bg-[#FFF8EC] px-4 py-3 space-y-3">
      <h2 className="font-heading text-lg font-bold text-[#2C2420]">Waiting for your approval</h2>
      {pending.map((a) => (
        <div key={a.id} className="space-y-1">
          <p className="text-[15px] text-[#2C2420]">
            {a.askedBy.split(" ")[0] || "A planner"} asked for: {a.summary}
          </p>
          <p className="text-[15px] text-[#2C2420]">{a.priceText}</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy === a.id} onClick={() => decide(a.id, true)} className="rounded-lg bg-[#3F5F2A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
              Approve
            </button>
            <button type="button" disabled={busy === a.id} onClick={() => decide(a.id, false)} className="rounded-lg border border-[#A0412D] text-[#A0412D] px-4 py-2 text-sm font-medium disabled:opacity-40">
              Decline
            </button>
          </div>
        </div>
      ))}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}

/** The other planners on the event. The Lead on a planner held event can add and remove them. */
export function PlannerList({ eventKey, planners, canManage }: { eventKey: string; planners: { name: string; company: string; isLead: boolean; you: boolean; id?: string }[]; canManage: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState({ name: "", company: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const err = await post("/api/partners/planners", { key: eventKey, action: "add", ...v });
    setBusy(false);
    if (err) setError(err);
    else {
      setAdding(false);
      setV({ name: "", company: "", phone: "" });
      router.refresh();
    }
  };
  const remove = async (id: string) => {
    setBusy(true);
    setError("");
    const err = await post("/api/partners/planners", { key: eventKey, action: "remove", partnerId: id });
    setBusy(false);
    if (err) setError(err);
    router.refresh();
  };
  return (
    <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 space-y-2">
      <h2 className="font-heading text-lg font-bold text-[#2C2420]">Planners on this event</h2>
      <ul className="space-y-1">
        {planners.map((p, i) => (
          <li key={i} className="flex items-center justify-between gap-2 text-[15px] text-[#2C2420]">
            <span>
              {p.name}
              {p.company ? `, ${p.company}` : ""}
              {p.isLead ? " (Lead)" : ""}
              {p.you ? " (you)" : ""}
            </span>
            {canManage && !p.isLead && !p.you && p.id && (
              <button type="button" disabled={busy} onClick={() => remove(p.id!)} className="text-sm text-[#A0412D] underline">
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {canManage &&
        (adding ? (
          <form onSubmit={add} className="space-y-2">
            <input className={input} placeholder="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
            <input className={input} placeholder="Company (optional)" value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} />
            <input className={input} type="tel" placeholder="Mobile number" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} required />
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
                {busy ? "Adding..." : "Add planner"}
              </button>
              <button type="button" onClick={() => setAdding(false)} className="text-sm text-[#6B5D52] underline">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="text-sm text-[#B5845A] underline">
            Add another planner
          </button>
        ))}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}

/** The Lead's switches: other planners and the host see no money unless the Lead turns these on. */
export function LeadSwitches({ eventKey, others, host, hostOnEvent }: { eventKey: string; others: boolean; host: boolean; hostOnEvent: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const flip = async (sw: string, on: boolean) => {
    setBusy(true);
    setError("");
    const err = await post("/api/partners/switch", { key: eventKey, switch: sw, on });
    setBusy(false);
    if (err) setError(err);
    router.refresh();
  };
  return (
    <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 space-y-2">
      <h2 className="font-heading text-lg font-bold text-[#2C2420]">Who sees pricing</h2>
      <p className="text-sm text-[#6B5D52]">Off by default. You may be charging your client a different amount, so we never show our pricing unless you turn it on.</p>
      <label className="flex items-center gap-2 text-[15px] text-[#2C2420]">
        <input type="checkbox" checked={others} disabled={busy} onChange={(e) => flip("others_can_see_pricing", e.target.checked)} />
        Other planners can see pricing
      </label>
      {hostOnEvent && (
        <label className="flex items-center gap-2 text-[15px] text-[#2C2420]">
          <input type="checkbox" checked={host} disabled={busy} onChange={(e) => flip("host_can_see_pricing", e.target.checked)} />
          Host can see pricing
        </label>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}
