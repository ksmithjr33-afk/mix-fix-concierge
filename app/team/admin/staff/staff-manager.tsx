"use client";

import { useState } from "react";
import type { StaffRecord } from "@/lib/team/assignments";

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
  return { ...data.staff, alerts: data.staff.alerts !== false };
}

function StaffForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { first: string; last: string; phone: string; role: "bartender" | "admin" };
  submitLabel: string;
  onSubmit: (v: { first: string; last: string; phone: string; role: string }) => Promise<void>;
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
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-xl bg-[#B5845A] text-white px-5 py-2.5 font-medium disabled:opacity-40">
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

function StaffRow({ s, meId, onSaved }: { s: StaffRecord; meId: string; onSaved: (s: StaffRecord) => void }) {
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
          initial={{ ...splitName(s.name), phone: prettyPhone(s.phone), role: s.role }}
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
        </div>
        <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-sm text-[#B5845A] underline">
          Edit
        </button>
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

export default function StaffManager({ initial, meId }: { initial: StaffRecord[]; meId: string }) {
  const [staff, setStaff] = useState(initial);
  const [adding, setAdding] = useState(false);
  const upsert = (s: StaffRecord) => setStaff((list) => (list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [s, ...list]));
  const active = staff.filter((s) => s.active);
  const inactive = staff.filter((s) => !s.active);

  return (
    <div className="space-y-3">
      <section className={card}>
        {adding ? (
          <>
            <h2 className="font-heading text-base font-bold text-[#2C2420] mb-2">Add a staff member</h2>
            <StaffForm
              initial={{ first: "", last: "", phone: "", role: "bartender" }}
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
      <section className={card}>
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Active ({active.length})</h2>
        <ul className="divide-y divide-[#DDD5CC]">
          {active.map((s) => (
            <StaffRow key={s.id} s={s} meId={meId} onSaved={upsert} />
          ))}
        </ul>
      </section>
      {inactive.length > 0 && (
        <section className={card}>
          <h2 className="font-heading text-base font-bold text-[#2C2420]">Inactive ({inactive.length})</h2>
          <ul className="divide-y divide-[#DDD5CC]">
            {inactive.map((s) => (
              <StaffRow key={s.id} s={s} meId={meId} onSaved={upsert} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
