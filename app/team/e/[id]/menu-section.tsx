"use client";

import { useState } from "react";
import type { StaffMenuSection } from "@/lib/team/approved-menu-db";

/**
 * The menu on a bartender's event page (Details tab): the approved menu, where
 * it is printed, who is picking it up, and whether it has been picked up.
 * Read only, except for the person picking it up, who gets "I picked it up".
 * Only built for staff on the event.
 */
export default function MenuSection({ menu }: { menu: StaffMenuSection }) {
  const [line, setLine] = useState(menu.pickedUpLine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mark = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/menu-pickup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: menu.sessionId, action: "picked_up" }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setLine(d.line || "Picked up.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const status = menu.notNeeded
    ? "No printed menu for this event."
    : line
      ? line
      : menu.pickupPerson
        ? `Not picked up yet${menu.isPickupPerson ? "." : `. ${menu.pickupPerson} is picking it up.`}`
        : "Not picked up yet. Nobody is assigned yet.";

  return (
    <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4 space-y-2" aria-label="Menu">
      <h2 className="font-heading text-lg font-bold text-[#2C2420]">Menu</h2>
      {menu.file ? (
        menu.file.type === "application/pdf" ? (
          <a href={menu.file.viewHref} target="_blank" rel="noopener noreferrer" className="inline-block rounded-lg border border-[#DDD5CC] bg-white px-3 py-2 text-[15px] text-[#9A7049] underline">
            Open the approved menu (PDF)
          </a>
        ) : (
          <a href={menu.file.viewHref} target="_blank" rel="noopener noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={menu.file.viewHref} alt="The approved cocktail menu" className="max-h-96 w-auto max-w-full rounded-lg border border-[#DDD5CC] bg-white" />
          </a>
        )
      ) : (
        <p className="text-[15px] text-[#6B5D52]">The approved menu is not uploaded yet.</p>
      )}
      {!menu.notNeeded && (
        <dl className="text-[15px] text-[#2C2420] space-y-0.5">
          <div>
            <dt className="inline text-[#6B5D52]">Printed at: </dt>
            <dd className="inline">{menu.store || "Not set yet"}</dd>
          </div>
          <div>
            <dt className="inline text-[#6B5D52]">Picking it up: </dt>
            <dd className="inline">{menu.isPickupPerson ? "You" : menu.pickupPerson || "Nobody yet"}</dd>
          </div>
        </dl>
      )}
      <p className={`text-[15px] ${line ? "text-[#55684A] font-medium" : "text-[#6B5D52]"}`}>{status}</p>
      {menu.isPickupPerson && !line && (
        <button type="button" onClick={mark} disabled={busy} className="w-full rounded-xl bg-[#B5845A] text-white py-3 text-lg font-medium hover:bg-[#9A7049] disabled:opacity-40">
          {busy ? "Saving..." : "I picked it up"}
        </button>
      )}
      {menu.isPickupPerson && menu.file && (
        <a href={menu.file.downloadHref} className="block text-center text-sm text-[#9A7049] underline">
          Download print file
        </a>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}
