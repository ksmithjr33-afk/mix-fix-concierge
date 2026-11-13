"use client";

import { useState } from "react";
import type { StaffRecord } from "@/lib/team/assignments";
import type { StaffOverview } from "@/lib/team/profile-db";

const CERT_TONE: Record<string, string> = {
  ok: "bg-[#E4EBDF] text-[#55684A]",
  amber: "bg-[#FFF3DF] text-[#9A5B12]",
  red: "bg-[#F6E3DC] text-[#A0412D]",
  missing: "bg-[#E8DDD5] text-[#6B5D52]",
};

/** Markets, drop off time, max distance, certificates and completeness, at a glance. */
function Glance({ o }: { o: StaffOverview }) {
  return (
    <div className="space-y-1">
      <p className="text-sm text-[#6B5D52]">
        Drop offs: {o.dropoffTime || "not set"} · Drives up to {o.maxMiles ? `${o.maxMiles} mi` : "not set"}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {o.certs.map((c) => (
          <span key={c.certType} className={`text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${CERT_TONE[c.tone]}`}>
            {c.certType} {c.text}
          </span>
        ))}
        <span
          className={`text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${o.done === o.total ? "bg-[#E4EBDF] text-[#55684A]" : "bg-[#E8DDD5] text-[#6B5D52]"}`}
          title={o.missing.length ? `Missing: ${o.missing.join(", ")}` : "Profile complete"}
        >
          {o.done === o.total ? "Profile complete" : `Profile ${o.done} of ${o.total}`}
        </span>
      </div>
    </div>
  );
}

const MARKET_CHOICES: [string, string][] = [
  ["dallas", "Dallas"],
  ["austin", "Austin"],
  ["houston", "Houston"],
  ["los_angeles", "Los Angeles"],
];
const marketNames = (ms: string[]) => MARKET_CHOICES.filter(([v]) => ms.includes(v)).map(([, l]) => l).join(", ");

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";
const input =
  "w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2.5 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30";

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

/** "+12145550101" as "(214) 555-0101". */
function prettyPhone(p: string): string {
  const d = p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}

async function save(method: "POST" | "PATCH", body: Record<string, unknown>): Promise<StaffRecord> {
  const res = await fetch("/api/team/admin/staff", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Could not save.");
  return { ...data.staff, alerts: data.staff.alerts !== false, markets: data.staff.markets ?? ["dallas"] };
}

function StaffForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { first: string; last: string; phone: string; role: "bartender" | "admin"; markets: string[] };
  submitLabel: string;
  onSubmit: (v: { first: string; last: string; phone: string; role: string; markets: string[] }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (v.markets.length === 0) {
          setError("Pick at least one market.");
          return;
        }
        setBusy(true);
        setError("");
        try {
          await onSubmit(v);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not save.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <input className={input} placeholder="First name" value={v.first} onChange={(e) => setV({ ...v, first: e.target.value })} maxLength={40} required />
        <input className={input} placeholder="Last name" value={v.last} onChange={(e) => setV({ ...v, last: e.target.value })} maxLength={40} required />
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input className={input} type="tel" inputMode="tel" placeholder="Phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} required />
        <select className={input} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as "bartender" | "admin" })} aria-label="Role">
          <option value="bartender">Bartender</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <fieldset>
        <legend className="text-xs text-[#A39585] uppercase tracking-wide mb-1">Markets (at least one)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {MARKET_CHOICES.map(([m, label]) => (
            <label key={m} className="flex items-center gap-1.5 text-[15px] text-[#2C2420]">
              <input
                type="checkbox"
                checked={v.markets.includes(m)}
                onChange={(e) => setV({ ...v, markets: e.target.checked ? [...v.markets, m] : v.markets.filter((x) => x !== m) })}
              />
              {label}
            </label>
          ))}
        </div>
        {v.markets.length === 0 && <p className="text-xs text-[#9A7049] mt-1">Pick at least one market to save.</p>}
      </fieldset>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || v.markets.length === 0} className="rounded-xl bg-[#B5845A] text-white px-5 py-2.5 font-medium disabled:opacity-40">
          {busy ? "Saving..." : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm text-[#6B5D52] underline px-2">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Toggle({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex items-center gap-2 text-sm text-[#2C2420] disabled:opacity-40"
    >
      <span className={`relative w-9 h-5 rounded-full transition-colors ${on ? "bg-[#8B9E7E]" : "bg-[#C9BDB2]"}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
      {label} {on ? "on" : "off"}
    </button>
  );
}

function StaffRow({ s, meId, onSaved, notes, overview }: { s: StaffRecord; meId: string; onSaved: (s: StaffRecord) => void; notes?: string[]; overview?: StaffOverview }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const me = s.id === meId;

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      onSaved(await save("PATCH", { id: s.id, ...body }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <li className="py-3">
        <StaffForm
          initial={{ ...splitName(s.name), phone: prettyPhone(s.phone), role: s.role, markets: s.markets }}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            onSaved(await save("PATCH", { id: s.id, ...v }));
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className={`py-3 space-y-1.5 ${s.active ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-[#2C2420] break-words">
            {s.name || "No name yet"}
            {me && <span className="text-xs text-[#A39585]"> (you)</span>}
          </p>
          <p className="text-sm text-[#6B5D52]">
            <a href={`tel:${s.phone}`} className="underline">
              {prettyPhone(s.phone)}
            </a>
            {" · "}
            {s.role === "admin" ? "Admin" : "Bartender"}
            {!s.active && " · Inactive"}
          </p>
          <p className="text-sm text-[#6B5D52]">Markets: {marketNames(s.markets) || "None"}</p>
          {overview && <Glance o={overview} />}
          {(notes ?? []).map((n) => (
            <p key={n} className="text-sm text-[#6B5D52] break-words">
              {n}
            </p>
          ))}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <button type="button" onClick={() => setEditing(true)} className="text-sm text-[#B5845A] underline">
            Edit
          </button>
          <a href={`/team/admin/staff/${s.id}`} className="text-sm text-[#B5845A] underline">
            Details
          </a>
          <a href={`/team/admin/preview/${s.id}`} className="text-sm text-[#B5845A] underline">
            Preview as
          </a>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {s.role === "admin" && s.active && <Toggle on={s.alerts} label="Alerts" disabled={busy} onChange={(alerts) => patch({ alerts })} />}
        {!me && (
          <button type="button" disabled={busy} onClick={() => patch({ active: !s.active })} className="text-sm text-[#6B5D52] underline disabled:opacity-40">
            {s.active ? "Deactivate" : "Reactivate"}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </li>
  );
}

type Filter = "all" | "expiring" | "incomplete";

export default function StaffManager({
  initial,
  meId,
  notes = {},
  overview = {},
}: {
  initial: StaffRecord[];
  meId: string;
  notes?: Record<string, string[]>;
  overview?: Record<string, StaffOverview>;
}) {
  const [staff, setStaff] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const upsert = (s: StaffRecord) => setStaff((list) => (list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [s, ...list]));
  const shown = staff.filter((s) => filter === "all" || (filter === "expiring" ? overview[s.id]?.expiringSoon : overview[s.id] && overview[s.id].done < overview[s.id].total));
  const active = shown.filter((s) => s.active);
  const inactive = shown.filter((s) => !s.active);
  const counts = {
    expiring: staff.filter((s) => s.active && overview[s.id]?.expiringSoon).length,
    incomplete: staff.filter((s) => s.active && overview[s.id] && overview[s.id].done < overview[s.id].total).length,
  };

  return (
    <div className="space-y-3">
      <section className={card}>
        {adding ? (
          <>
            <h2 className="font-heading text-base font-bold text-[#2C2420] mb-2">Add a staff member</h2>
            <StaffForm
              initial={{ first: "", last: "", phone: "", role: "bartender", markets: [] }}
              submitLabel="Add"
              onCancel={() => setAdding(false)}
              onSubmit={async (v) => {
                upsert(await save("POST", v));
                setAdding(false);
              }}
            />
            <p className="text-xs text-[#A39585] mt-2">They sign in at /team with this phone number.</p>
          </>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="w-full rounded-xl bg-[#B5845A] text-white py-2.5 font-medium">
            Add a staff member
          </button>
        )}
      </section>
      <div className="flex flex-wrap gap-1 bg-[#DDD5CC] p-1 rounded-xl" role="tablist" aria-label="Show">
        {(
          [
            ["all", "Everyone"],
            ["expiring", `Expiring soon (${counts.expiring})`],
            ["incomplete", `Profile incomplete (${counts.incomplete})`],
          ] as [Filter, string][]
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={filter === k}
            onClick={() => setFilter(k)}
            className={`flex-1 whitespace-nowrap px-2 py-1.5 rounded-lg text-sm font-medium ${filter === k ? "bg-[#F5F0EB] text-[#2C2420] shadow-sm" : "text-[#6B5D52]"}`}
          >
            {l}
          </button>
        ))}
      </div>
      <section className={card}>
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Active ({active.length})</h2>
        {active.length === 0 && filter !== "all" && <p className="text-sm text-[#6B5D52] py-2">Nobody matches.</p>}
        <ul className="divide-y divide-[#DDD5CC]">
          {active.map((s) => (
            <StaffRow key={s.id} s={s} meId={meId} onSaved={upsert} notes={notes[s.id]} overview={overview[s.id]} />
          ))}
        </ul>
      </section>
      {inactive.length > 0 && (
        <section className={card}>
          <h2 className="font-heading text-base font-bold text-[#2C2420]">Inactive ({inactive.length})</h2>
          <ul className="divide-y divide-[#DDD5CC]">
            {inactive.map((s) => (
              <StaffRow key={s.id} s={s} meId={meId} onSaved={upsert} notes={notes[s.id]} overview={overview[s.id]} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
