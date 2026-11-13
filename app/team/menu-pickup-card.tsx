"use client";

import Link from "next/link";
import { useState } from "react";
import type { MyPickup } from "@/lib/team/menu-pickup-db";

/**
 * "Pick up the menu": the assigned person's card on their home screen and
 * event page, with the store, note and order number and a large "I picked it
 * up" button. The server only accepts it from the assigned person or an admin.
 */
export default function MyPickupCard({ pickup, showEvent = true }: { pickup: MyPickup; showEvent?: boolean }) {
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mark = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/menu-pickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: pickup.sessionId, action: "picked_up" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setDone(d.line || "Picked up. Thank you!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border-2 border-[#B5845A] bg-[#FFF8EC] px-4 py-3 sm:px-5 sm:py-4 space-y-2" aria-label="Pick up the menu">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="font-heading text-lg font-bold text-[#2C2420]">Pick up the menu</h2>
        {showEvent && (
          <span className="text-[15px] text-[#6B5D52]">
            {pickup.eventHref ? (
              <Link href={pickup.eventHref} className="underline">
                {pickup.title}
              </Link>
            ) : (
              pickup.title
            )}
            , {pickup.date}
          </span>
        )}
      </div>
      <dl className="text-[15px] text-[#2C2420] space-y-0.5">
        <div>
          <dt className="inline text-[#6B5D52]">Store: </dt>
          <dd className="inline font-medium">{pickup.store || "Ask the office which store"}</dd>
        </div>
        {pickup.note && (
          <div>
            <dt className="inline text-[#6B5D52]">Location or note: </dt>
            <dd className="inline">{pickup.note}</dd>
          </div>
        )}
        {pickup.order && (
          <div>
            <dt className="inline text-[#6B5D52]">Order number: </dt>
            <dd className="inline font-medium tabular-nums">{pickup.order}</dd>
          </div>
        )}
      </dl>
      {pickup.printFileHref ? (
        <a href={pickup.printFileHref} className="block w-full rounded-xl border-2 border-[#B5845A] bg-white text-[#9A7049] py-3 text-center text-[15px] font-medium hover:bg-[#FFF3DF]">
          Download print file
        </a>
      ) : (
        <p className="text-sm text-[#6B5D52]">The print file shows here once the office uploads the approved menu.</p>
      )}
      {done ? (
        <p className="w-full rounded-xl bg-[#8B9E7E] text-white py-3 text-center text-[15px] font-medium">{done}</p>
      ) : (
        <button type="button" onClick={mark} disabled={busy} className="w-full rounded-xl bg-[#B5845A] text-white py-3.5 text-lg font-medium hover:bg-[#9A7049] disabled:opacity-40">
          {busy ? "Saving..." : "I picked it up"}
        </button>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}
