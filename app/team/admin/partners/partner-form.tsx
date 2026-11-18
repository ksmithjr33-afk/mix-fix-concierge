"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input = "w-full rounded-lg border border-[#DDD5CC] bg-white px-3 py-2 text-[15px] text-[#2C2420]";
const MARKETS = [
  ["dallas", "Dallas"],
  ["austin", "Austin"],
  ["houston", "Houston"],
  ["los_angeles", "Los Angeles"],
] as const;

export interface PartnerValues {
  name: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  markets: string[];
  internal_notes: string;
}

const EMPTY: PartnerValues = { name: "", company: "", phone: "", email: "", website: "", markets: [], internal_notes: "" };

async function send(method: "POST" | "PATCH", body: unknown): Promise<{ error?: string; id?: string }> {
  try {
    const res = await fetch("/api/team/admin/partners", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? data : { error: data.error ?? "Could not save." };
  } catch {
    return { error: "Could not reach the server. Try again." };
  }
}

function Fields({ v, setV }: { v: PartnerValues; setV: (v: PartnerValues) => void }) {
  const set = (k: keyof PartnerValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-sm text-[#6B5D52]">
        Name
        <input className={input} value={v.name} onChange={set("name")} maxLength={80} required />
      </label>
      <label className="text-sm text-[#6B5D52]">
        Company
        <input className={input} value={v.company} onChange={set("company")} maxLength={120} />
      </label>
      <label className="text-sm text-[#6B5D52]">
        Phone (their login)
        <input className={input} type="tel" value={v.phone} onChange={set("phone")} required />
      </label>
      <label className="text-sm text-[#6B5D52]">
        Email
        <input className={input} type="email" value={v.email} onChange={set("email")} maxLength={200} />
      </label>
      <label className="text-sm text-[#6B5D52] sm:col-span-2">
        Website
        <input className={input} value={v.website} onChange={set("website")} maxLength={300} />
      </label>
      <fieldset className="text-sm text-[#6B5D52] sm:col-span-2">
        <legend>Markets</legend>
        <div className="flex flex-wrap gap-3 mt-1">
          {MARKETS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-1 text-[#2C2420]">
              <input type="checkbox" checked={v.markets.includes(k)} onChange={(e) => setV({ ...v, markets: e.target.checked ? [...v.markets, k] : v.markets.filter((m) => m !== k) })} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="text-sm text-[#6B5D52] sm:col-span-2">
        Internal notes (admins and managers only, never shown to the partner)
        <textarea className={input} rows={3} value={v.internal_notes} onChange={set("internal_notes")} maxLength={4000} />
      </label>
    </div>
  );
}

/** Add a planner from the Partners page. */
export default function AddPartner() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<PartnerValues>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mx-1 rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium">
        Add a planner
      </button>
    );
  }
  return (
    <form
      className="rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const r = await send("POST", v);
        setBusy(false);
        if (r.error) return setError(r.error);
        router.push(`/team/admin/partners/${encodeURIComponent(r.id ?? "")}`);
      }}
    >
      <h2 className="font-heading text-lg font-bold text-[#2C2420]">Add a planner</h2>
      <Fields v={v} setV={setV} />
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
          {busy ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-[#6B5D52] underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Edit, deactivate, or turn back on, from a partner's page. */
export function EditPartner({ id, initial, active }: { id: string; initial: PartnerValues; active: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<PartnerValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [confirming, setConfirming] = useState(false);
  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setError("");
    setMsg("");
    const r = await send("PATCH", { id, ...body });
    setBusy(false);
    if (r.error) return setError(r.error);
    setMsg(done);
    setConfirming(false);
    router.refresh();
  };
  return (
    <div className="space-y-3">
      <form
        className="rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void act({ ...v }, "Saved.");
        }}
      >
        <h2 className="font-heading text-lg font-bold text-[#2C2420]">Profile</h2>
        <Fields v={v} setV={setV} />
        <button type="submit" disabled={busy} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
          {busy ? "Saving..." : "Save"}
        </button>
      </form>
      <div className="px-1 space-y-2">
        {active ? (
          confirming ? (
            <div className="rounded-2xl bg-[#FDECEA] border border-[#E7B8B2] px-4 py-3 space-y-2">
              <p className="text-[15px] text-[#2C2420]">Deactivate? Their access to every event ends right away, and admins get a text about any event they hold or lead.</p>
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => act({ action: "deactivate" }, "Deactivated.")} className="rounded-lg bg-[#A0412D] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
                  Yes, deactivate
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="text-sm text-[#6B5D52] underline">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="text-sm text-[#A0412D] underline">
              Deactivate this partner
            </button>
          )
        ) : (
          <button type="button" disabled={busy} onClick={() => act({ action: "reactivate" }, "Turned back on.")} className="rounded-lg border border-[#2C2420] px-4 py-2 text-sm">
            Turn this partner back on
          </button>
        )}
        {error && <p className="text-sm text-[#A0412D]">{error}</p>}
        {msg && <p className="text-sm text-[#3F5F2A]">{msg}</p>}
      </div>
    </div>
  );
}
