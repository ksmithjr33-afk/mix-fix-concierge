"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input =
  "w-full rounded-xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]";

export default function NameForm({ next }: { next: string }) {
  const router = useRouter();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ first, last }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save. Try again.");
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <input className={input} placeholder="First name" autoComplete="given-name" value={first} onChange={(e) => setFirst(e.target.value)} maxLength={40} required autoFocus />
      <input className={input} placeholder="Last name" autoComplete="family-name" value={last} onChange={(e) => setLast(e.target.value)} maxLength={40} required />
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <button
        type="submit"
        disabled={busy || !first.trim() || !last.trim()}
        className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40 hover:bg-[#9A7049] transition-colors"
      >
        {busy ? "Saving..." : "Continue"}
      </button>
    </form>
  );
}
