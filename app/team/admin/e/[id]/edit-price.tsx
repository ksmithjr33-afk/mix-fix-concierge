"use client";

// The price choice and the client shopping list choice for an admin edit,
// shared by "Edit everything" (edit-event.tsx) and the one field at a time
// editor on the Details cards (editable-details.tsx). Both post to
// /api/team/admin/event-edit, which prices with the engine and saves.

import type { PriceMode } from "@/lib/team/admin-edit";

export interface Preview {
  priced: boolean;
  bookedTotal: number | null;
  engineAmount: number | null;
  engineNewTotal: number | null;
  engineText: string;
  listChanges: string;
  autoSend: boolean;
  serviceFee?: boolean;
  bookedBreakdown?: string | null; // "Package $1,572.25 · Service fee (20%) $314.45 · Add ons $150"
  engineBreakdown?: string | null;
  paidCents?: number | null; // payments recorded, null when none
  balanceNow?: number | null;
  balanceAfter?: number | null;
}

export type Mode = "" | PriceMode;

export const editInput =
  "w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2.5 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30";

export const money = (n: number | null) => (n === null ? "unknown" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

/** The engine's quote for a change, without saving. */
export async function fetchPreview(sessionId: string, changes: Record<string, string>): Promise<Preview> {
  const res = await fetch("/api/team/admin/event-edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, changes, preview: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Could not price this change.");
  return data.preview as Preview;
}

/** True when the engine priced the change and could not put a total on it. */
export const engineCannotPrice = (p: Preview | null) => !!p && p.engineNewTotal === null;

/** A price choice is complete: picked, a manual total typed, and an engine choice only when the engine priced it. */
export function priceChosen(mode: Mode, manual: string, preview: Preview | null): boolean {
  if (mode === "") return false;
  if (mode === "manual") return manual.trim() !== "";
  if (mode === "engine") return !!preview && preview.engineNewTotal !== null;
  if (mode === "pending") return engineCannotPrice(preview);
  return true;
}

export function PriceFieldset({
  mode,
  setMode,
  manual,
  setManual,
  preview,
  previewError,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  manual: string;
  setManual: (v: string) => void;
  preview: Preview | null;
  previewError: string;
}) {
  const radio = "mt-1 h-5 w-5 accent-[#B5845A]";
  const row = "flex items-start gap-2 text-[15px] text-[#2C2420] min-h-[44px]";
  return (
    <fieldset className="rounded-xl border border-[#E3C9A0] bg-[#FFF8EC] px-3 py-3 space-y-2">
      <legend className="px-1 text-sm font-bold text-[#2C2420]">Price</legend>
      <label className={row}>
        <input type="radio" name="price" className={radio} checked={mode === "keep"} onChange={() => setMode("keep")} />
        <span>
          Keep the booked total as is
          <span className="block text-sm text-[#6B5D52]">Booked total {money(preview?.bookedTotal ?? null)}</span>
          {preview?.bookedBreakdown && <span className="block text-sm text-[#6B5D52]">{preview.bookedBreakdown}</span>}
        </span>
      </label>
      <label className={row}>
        <input type="radio" name="price" className={radio} checked={mode === "engine"} onChange={() => setMode("engine")} disabled={preview?.engineNewTotal === null} />
        <span>
          Apply the pricing engine&apos;s difference
          <span className="block text-sm text-[#6B5D52]">
            {previewError
              ? previewError
              : !preview
                ? "Pricing..."
                : preview.engineNewTotal === null
                  ? "The engine cannot price this change. Leave it price pending, keep the total, or enter one by hand."
                  : `${preview.engineAmount !== null && preview.engineAmount >= 0 ? "+" : "-"}${money(Math.abs(preview.engineAmount ?? 0))}, new total ${money(preview.engineNewTotal)}`}
          </span>
          {preview?.engineBreakdown && preview.engineNewTotal !== null && <span className="block text-sm text-[#6B5D52]">{preview.engineBreakdown}</span>}
        </span>
      </label>
      {engineCannotPrice(preview) && (
        <label className={row}>
          <input type="radio" name="price" className={radio} checked={mode === "pending"} onChange={() => setMode("pending")} />
          <span>
            Save it and leave the price pending
            <span className="block text-sm text-[#6B5D52]">Like a client change the engine cannot price: the event shows Price needed until someone sets the new total, and the admins get one text.</span>
          </span>
        </label>
      )}
      <label className={row}>
        <input type="radio" name="price" className={radio} checked={mode === "manual"} onChange={() => setMode("manual")} />
        <span className="flex-1">
          Enter a new total by hand
          {mode === "manual" && (
            <input type="text" inputMode="decimal" placeholder="New total, like 1850" value={manual} onChange={(e) => setManual(e.target.value)} className={`${editInput} mt-1`} autoFocus />
          )}
          {mode === "manual" && preview?.serviceFee && <span className="block text-sm text-[#6B5D52]">The service fee is carved out of the new total less add ons.</span>}
        </span>
      </label>
      {preview && (
        <p className="text-sm text-[#6B5D52]">
          {preview.paidCents === null || preview.paidCents === undefined
            ? "Remaining balance: no payments recorded yet, so no balance is stated."
            : `Paid so far ${money(preview.paidCents / 100)}. Remaining balance now ${money(preview.balanceNow ?? null)}${preview.balanceAfter !== null && preview.balanceAfter !== undefined ? `, after the engine's change ${money(preview.balanceAfter)}` : ""}.`}
        </p>
      )}
    </fieldset>
  );
}

export function ListFieldset({ preview, sendList, setSendList }: { preview: Preview; sendList: boolean; setSendList: (v: boolean) => void }) {
  return (
    <fieldset className="rounded-xl border border-[#DDD5CC] bg-white px-3 py-3 space-y-2">
      <legend className="px-1 text-sm font-bold text-[#2C2420]">Client shopping list</legend>
      <p className="text-sm text-[#6B5D52] whitespace-pre-line">This edit changes the client&apos;s list:{"\n"}{preview.listChanges}</p>
      <label className="flex items-start gap-2 text-[15px] text-[#2C2420] min-h-[44px]">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-[#B5845A]" checked={sendList} onChange={(e) => setSendList(e.target.checked)} />
        <span>
          Send updated list to client
          {!preview.autoSend && <span className="block text-sm text-[#6B5D52]">Auto send client shopping list is off, so nothing goes to the client either way.</span>}
        </span>
      </label>
    </fieldset>
  );
}
