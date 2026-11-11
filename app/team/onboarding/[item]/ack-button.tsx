"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AckButton({ itemId, label, done: initial }: { itemId: string; label: string; done: boolean }) {
  const router = useRouter();
  const [done, setDone] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (done) return <p className="rounded-2xl bg-[#E4EBDF] text-[#55684A] px-4 py-3 text-[15px] font-medium">Done. Thanks.</p>;
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const res = await fetch("/api/team/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId }) });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error ?? "Could not save.");
            setDone(true);
            router.push("/team/onboarding");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save.");
          } finally {
            setBusy(false);
          }
        }}
        className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40"
      >
        {busy ? "Saving..." : label}
      </button>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </div>
  );
}
