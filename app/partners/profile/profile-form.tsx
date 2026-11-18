"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input = "w-full rounded-xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]";

type Values = { name: string; company: string; email: string; website: string };

/** Name, company, email and website. The phone is the login, so it is shown, not edited. */
export default function ProfileForm({ initial, phone }: { initial: Values; phone: string }) {
  const router = useRouter();
  const [v, setV] = useState<Values>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/partners/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "Could not save.");
      else {
        setMsg("Saved.");
        router.refresh();
      }
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <label className="block text-sm text-[#6B5D52]">
        Name
        <input className={input} value={v.name} onChange={set("name")} maxLength={80} required />
      </label>
      <label className="block text-sm text-[#6B5D52]">
        Company
        <input className={input} value={v.company} onChange={set("company")} maxLength={120} />
      </label>
      <label className="block text-sm text-[#6B5D52]">
        Email
        <input className={input} type="email" value={v.email} onChange={set("email")} maxLength={200} />
      </label>
      <label className="block text-sm text-[#6B5D52]">
        Website
        <input className={input} value={v.website} onChange={set("website")} maxLength={300} />
      </label>
      <p className="text-sm text-[#6B5D52]">
        Phone: {phone}. This is how you sign in. To change it, text us at 469 754 8512.
      </p>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      {msg && <p className="text-sm text-[#3F5F2A]">{msg}</p>}
      <button type="submit" disabled={busy} className="rounded-xl bg-[#B5845A] text-white px-5 py-2.5 font-medium disabled:opacity-40">
        {busy ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
