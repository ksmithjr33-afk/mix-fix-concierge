"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProfilePage } from "@/lib/team/profile-db";
import { DROPOFF_CHOICES } from "@/lib/team/profile";

const field =
  "w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2.5 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]";
const label = "block text-xs text-[#A39585] uppercase tracking-wide";

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

function prettyPhone(p: string): string {
  const d = p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}

/**
 * The profile form: on the bartender's own Me page, and on the admin's staff
 * detail page (staffId set). Phone is shown but changed only by admins, with
 * Edit on the Staff page, because it is how the person signs in.
 */
export default function ProfileForm({ initial, staffId, next, admin = false }: { initial: ProfilePage; staffId?: string; next?: string; admin?: boolean }) {
  const router = useRouter();
  const v0 = initial.view;
  const [page, setPage] = useState(initial);
  const [name, setName] = useState(splitName(v0.name));
  const [email, setEmail] = useState(v0.email ?? "");
  const [home, setHome] = useState(v0.homeAddress ?? "");
  const [dropoff, setDropoff] = useState(v0.dropoffTime);
  const [miles, setMiles] = useState(v0.maxMiles ? String(v0.maxMiles) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const res = await fetch("/api/team/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(staffId ? { staffId } : {}), first: name.first, last: name.last, email, home_address: home, dropoff_time: dropoff, max_miles: miles }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setPage(d.profile);
      if (next) {
        router.replace(next);
        router.refresh();
        return;
      }
      setSaved(d.profile?.view?.homeAddress && !d.profile?.view?.homeLocated ? "Saved. We could not find that address on the map, so distances will not show. Check it has the city and state." : "Saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <p className="text-sm text-[#6B5D52]">
        Profile {page.done} of {page.total} complete
        {page.missing.length > 0 && <span className="text-[#9A7049]">. Missing: {page.missing.join(", ")}.</span>}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>
          First name
          <input className={`${field} mt-1`} value={name.first} onChange={(e) => setName({ ...name, first: e.target.value })} maxLength={40} autoComplete="given-name" required />
        </label>
        <label className={label}>
          Last name
          <input className={`${field} mt-1`} value={name.last} onChange={(e) => setName({ ...name, last: e.target.value })} maxLength={40} autoComplete="family-name" required />
        </label>
      </div>
      <div>
        <p className={label}>Phone</p>
        <p className="text-[15px] text-[#2C2420] mt-1">
          {prettyPhone(v0.phone)}{" "}
          <span className="text-sm text-[#6B5D52]">{admin ? "(change it with Edit on the Staff page)" : "(you sign in with it; text 469 754 8512 to change it)"}</span>
        </p>
      </div>
      <label className={label}>
        Email
        <input className={`${field} mt-1`} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
      </label>
      <label className={label}>
        Home address
        <input className={`${field} mt-1`} autoComplete="street-address" value={home} onChange={(e) => setHome(e.target.value)} maxLength={300} placeholder="Street, city, state" />
        <span className="block normal-case tracking-normal text-xs text-[#6B5D52] mt-1">Only you and the Mix Fix admins see your address and email. It is used to see how far events are from you.</span>
      </label>
      <label className={label}>
        Best time for material drop offs
        <input className={`${field} mt-1`} list="dropoff-choices" value={dropoff} onChange={(e) => setDropoff(e.target.value)} maxLength={100} placeholder="e.g. Weekday evenings after 5" />
        <datalist id="dropoff-choices">
          {DROPOFF_CHOICES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className={label}>
        Farthest you will drive to an event (miles)
        <input className={`${field} mt-1`} type="number" inputMode="numeric" min={1} max={500} value={miles} onChange={(e) => setMiles(e.target.value)} />
      </label>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || !name.first.trim() || !name.last.trim()} className="rounded-xl bg-[#B5845A] text-white px-5 py-2.5 font-medium disabled:opacity-40">
          {busy ? "Saving..." : next ? "Save and continue" : "Save profile"}
        </button>
        {saved && <span className="text-sm text-[#55684A]">{saved}</span>}
      </div>
    </form>
  );
}
