"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Request a shift offer, or pass. A request waits for an admin or manager to approve it. */
export default function OfferButtons({ stepId }: { stepId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "accept" | "decline">("");
  const [confirmPass, setConfirmPass] = useState(false);
  const [error, setError] = useState("");

  const send = async (response: "accept" | "decline") => {
    setBusy(response);
    setError("");
    try {
      const res = await fetch("/api/team/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stepId, response }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      router.refresh();
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-2">
      <button type="button" disabled={!!busy} onClick={() => send("accept")} className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40">
        {busy === "accept" ? "Sending..." : "Request this shift"}
      </button>
      {confirmPass ? (
        <div className="flex gap-2 items-center justify-center">
          <button type="button" disabled={!!busy} onClick={() => send("decline")} className="rounded-lg border border-[#A0412D] text-[#A0412D] px-4 py-2 text-sm font-medium disabled:opacity-40">
            {busy === "decline" ? "Saving..." : "Yes, pass"}
          </button>
          <button type="button" onClick={() => setConfirmPass(false)} className="text-sm text-[#6B5D52] underline px-2">
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" disabled={!!busy} onClick={() => setConfirmPass(true)} className="w-full rounded-xl border border-[#DDD5CC] text-[#6B5D52] py-3 font-medium disabled:opacity-40">
          Pass
        </button>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </div>
  );
}

/** Take back a request that is still waiting. */
export function WithdrawButton({ stepId }: { stepId: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const withdraw = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stepId, response: "withdraw" }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  };

  return (
    <div className="space-y-2">
      {confirm ? (
        <div className="flex gap-2 items-center justify-center">
          <button type="button" disabled={busy} onClick={withdraw} className="min-h-[44px] rounded-lg border border-[#A0412D] text-[#A0412D] px-4 text-sm font-medium disabled:opacity-40">
            {busy ? "Saving..." : "Yes, withdraw"}
          </button>
          <button type="button" onClick={() => setConfirm(false)} className="min-h-[44px] text-sm text-[#6B5D52] underline px-2">
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="min-h-[44px] text-sm text-[#6B5D52] underline">
          Withdraw my request
        </button>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </div>
  );
}
