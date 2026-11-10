"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Post every upcoming event that still needs bartenders to its market. */
export default function PostAll({ count, market }: { count: number; market: string | null }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (count === 0 && !message) return null;
  return (
    <div className="px-1 space-y-1">
      {message ? (
        <p className="text-sm text-[#55684A]">{message}</p>
      ) : confirm ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[#2C2420]">
            Post {count} unstaffed {count === 1 ? "event" : "events"}? Every active bartender in each market gets a text.
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await fetch("/api/team/admin/shifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "post_all", market }) });
                const d = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(d.error ?? "Could not post.");
                setMessage(
                  `Posted ${d.posted} ${d.posted === 1 ? "shift" : "shifts"}, ${d.notified} ${d.notified === 1 ? "text" : "texts"} sent.` +
                    (d.noMarket ? ` ${d.noMarket} need a market first.` : "")
                );
                router.refresh();
              } catch (err) {
                setMessage(err instanceof Error ? err.message : "Could not post.");
              } finally {
                setBusy(false);
                setConfirm(false);
              }
            }}
            className="rounded-lg bg-[#B5845A] text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            {busy ? "Posting..." : "Yes, post"}
          </button>
          <button type="button" onClick={() => setConfirm(false)} className="text-sm text-[#6B5D52] underline">
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="rounded-xl border border-[#B5845A] text-[#9A7049] px-4 py-2 text-sm font-medium">
          Post all unstaffed ({count})
        </button>
      )}
    </div>
  );
}
