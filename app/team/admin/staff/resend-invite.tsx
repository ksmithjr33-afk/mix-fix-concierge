"use client";

import { useState } from "react";

/**
 * Resend invite, for admins and managers on the Staff page and a staff
 * profile: last sign in next to the button so it is clear who needs it, then
 * "Invite sent to ••• 1234 at ..." so a wrong number is easy to spot. A failed
 * text says so instead.
 */
export default function ResendInvite({ staffId, signIn, lastInvite = "" }: { staffId: string; signIn: string; lastInvite?: string }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");
  const send = async () => {
    setBusy(true);
    setError("");
    setSent("");
    try {
      const res = await fetch("/api/team/admin/staff/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: staffId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not send the invite. Try again.");
      setSent(data.line);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the invite. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-resend-invite className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={send} disabled={busy} className="rounded-lg border border-[#B5845A] px-3 py-1.5 text-sm font-medium text-[#9A7049] disabled:opacity-40">
          {busy ? "Sending..." : "Resend invite"}
        </button>
        <span className={`text-sm ${signIn === "Never signed in" ? "font-medium text-[#A0412D]" : "text-[#6B5D52]"}`}>{signIn}</span>
      </div>
      {!sent && !error && lastInvite && <p className="text-xs text-[#A39585]">{lastInvite}</p>}
      {sent && (
        <p className="text-sm text-[#55684A]" role="status">
          {sent}
        </p>
      )}
      {error && (
        <p className="text-sm text-[#A0412D]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
