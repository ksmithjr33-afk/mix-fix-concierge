"use client";

import Link from "next/link";
import { useState } from "react";
import type { IcePersonView, IceView } from "@/lib/team/ice-pickup-db";

export const field =
  "w-full rounded-lg border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]";

/** POST to the ice pickup route. Returns the new view, or throws with the server's message. */
export async function postIce(sessionId: string, body: Record<string, unknown>): Promise<IceView> {
  const res = await fetch("/api/team/ice-pickup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, ...body }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.view) throw new Error(d.error ?? "Could not save.");
  return d.view as IceView;
}

export function IceStateBadge({ view }: { view: IceView }) {
  const n = view.people.length;
  const done = view.people.filter((p) => p.pickedUp).length;
  const [text, tone] =
    view.state === "complete"
      ? ["Ice picked up", "bg-[#E4EBDF] text-[#55684A]"]
      : view.state === "assigned"
        ? [n > 1 ? `${done} of ${n} picked up` : "Not picked up", view.outstanding ? "bg-[#F6E3DC] text-[#A0412D]" : "bg-[#E8DDD5] text-[#6B5D52]"]
        : ["No one assigned", view.outstanding ? "bg-[#F6E3DC] text-[#A0412D]" : "bg-[#E8DDD5] text-[#6B5D52]"];
  return <span className={`text-xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${tone}`}>{text}</span>;
}

/** The optional "where" and "how many bags" asked when marking ice picked up. */
export function PickedUpForm({
  location,
  bags,
  busy,
  label,
  onSave,
  onCancel,
}: {
  location: string;
  bags: number | null;
  busy: boolean;
  label: string;
  onSave: (v: { location: string; bags: string }) => void;
  onCancel: () => void;
}) {
  const [where, setWhere] = useState(location);
  const [count, setCount] = useState(bags === null ? "" : String(bags));
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-[#DDD5CC] bg-white px-3 py-3">
      <label className="block text-xs text-[#A39585] uppercase tracking-wide">
        Where did you get it? (optional)
        <input value={where} onChange={(e) => setWhere(e.target.value)} maxLength={120} className={`${field} mt-1`} />
      </label>
      <label className="block text-xs text-[#A39585] uppercase tracking-wide">
        How many bags? (optional)
        <input value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" className={`${field} mt-1`} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => onSave({ location: where, bags: count })} disabled={busy} className="rounded-lg bg-[#8B9E7E] text-white px-4 py-2 text-[15px] font-medium disabled:opacity-40">
          {busy ? "Saving..." : label}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="text-sm text-[#6B5D52] underline">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function PersonStatus({ p }: { p: IcePersonView }) {
  return p.pickedUp ? (
    <p className="flex items-start gap-2 text-sm text-[#55684A]">
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#8B9E7E] text-white text-xs" aria-hidden="true">
        ✓
      </span>
      {p.line}
    </p>
  ) : (
    <p className="text-sm text-[#A0412D]">Not picked up</p>
  );
}

const bagsText = (n: number | null) => (n === null ? "" : `${n} ${n === 1 ? "bag" : "bags"}`);

/**
 * The ice pickup card on the bartender event page (Details) and, for people
 * picking up ice, on their home screen. Everyone on the event sees who is
 * picking it up, the location and each status. The person picking up gets
 * "I picked up the ice" on their row; someone on the event who is not picking
 * up gets "I picked up the ice instead". The server checks every rule.
 */
export default function IcePickupCard({ initial, showEvent = false }: { initial: IceView; showEvent?: boolean }) {
  const [view, setView] = useState(initial);
  const [open, setOpen] = useState<"" | "mine" | "who" | "instead">("");
  const [covering, setCovering] = useState(""); // staff id, or "" for "Nobody, this is extra"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async (action: string, v: { location: string; bags: string }) => {
    setBusy(true);
    setError("");
    try {
      setView(await postIce(view.sessionId, { action, location: v.location, bags: v.bags, ...(action === "instead" ? { coveringFor: covering } : {}) }));
      setOpen("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const mine = view.people.find((p) => p.mine);
  const notYet = view.people.filter((p) => !p.pickedUp);
  const startInstead = () => {
    setError("");
    setCovering("");
    setOpen(notYet.length ? "who" : "instead");
  };
  const coveringName = notYet.find((p) => p.staffId === covering)?.name ?? "";
  const highlight = !!mine && !mine.pickedUp;

  return (
    <section
      className={`rounded-2xl px-4 py-3 sm:px-5 sm:py-4 space-y-2 ${highlight ? "border-2 border-[#B5845A] bg-[#FFF8EC]" : "border border-[#DDD5CC] bg-[#F5F0EB]"}`}
      aria-label="Ice pickup"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-heading text-lg font-bold text-[#2C2420]">{highlight ? "Pick up the ice" : "Ice pickup"}</h2>
        {showEvent ? (
          <span className="text-[15px] text-[#6B5D52]">
            {view.eventHref ? (
              <Link href={view.eventHref} className="underline">
                {view.title}
              </Link>
            ) : (
              view.title
            )}
            , {view.date}
          </span>
        ) : (
          <IceStateBadge view={view} />
        )}
      </div>
      <dl className="text-[15px] text-[#2C2420] space-y-0.5">
        <div>
          <dt className="inline text-[#6B5D52]">Where: </dt>
          <dd className="inline font-medium">{view.location || "Ask the office"}</dd>
        </div>
        {view.totalBags !== null && (
          <div>
            <dt className="inline text-[#6B5D52]">Total: </dt>
            <dd className="inline">{bagsText(view.totalBags)}</dd>
          </div>
        )}
        {view.notes && (
          <div>
            <dt className="inline text-[#6B5D52]">Notes: </dt>
            <dd className="inline">{view.notes}</dd>
          </div>
        )}
      </dl>

      {view.people.length === 0 ? (
        <p className="text-sm text-[#6B5D52]">No one is assigned to pick up ice yet.</p>
      ) : (
        <ul className="divide-y divide-[#DDD5CC] border-t border-[#DDD5CC]">
          {view.people.map((p) => (
            <li key={p.staffId} className="py-2">
              <p className="text-[15px] text-[#2C2420]">
                <span className="font-medium">{p.mine ? `${p.name} (you)` : p.name}</span>
                {p.bags !== null && <span className="text-[#6B5D52]"> · {bagsText(p.bags)}</span>}
              </p>
              <PersonStatus p={p} />
              {p.mine && !p.pickedUp && open !== "mine" && (
                <button type="button" onClick={() => setOpen("mine")} className="mt-2 w-full rounded-xl bg-[#B5845A] text-white py-3 text-lg font-medium hover:bg-[#9A7049]">
                  I picked up the ice
                </button>
              )}
              {p.mine && open === "mine" && (
                <PickedUpForm location={view.locationName} bags={p.bags} busy={busy} label="Save, picked up" onSave={(v) => send("picked_up", v)} onCancel={() => setOpen("")} />
              )}
            </li>
          ))}
        </ul>
      )}

      {view.canInstead && view.state !== "complete" && (
        open === "who" ? (
          <div className="space-y-2 rounded-xl border border-[#DDD5CC] bg-white px-3 py-3">
            <p className="text-[15px] font-medium text-[#2C2420]">Who are you covering for?</p>
            <div className="flex flex-col gap-2">
              {notYet.map((p) => (
                <button
                  key={p.staffId}
                  type="button"
                  onClick={() => {
                    setCovering(p.staffId);
                    setOpen("instead");
                  }}
                  className="w-full rounded-lg border border-[#B5845A] bg-white px-3 py-2.5 text-left text-[15px] text-[#2C2420] hover:bg-[#FFF3DF]"
                >
                  {p.name}
                  {p.bags !== null && <span className="text-[#6B5D52]"> · {bagsText(p.bags)}</span>}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setCovering("");
                  setOpen("instead");
                }}
                className="w-full rounded-lg border border-[#DDD5CC] bg-white px-3 py-2.5 text-left text-[15px] text-[#6B5D52] hover:bg-[#F5F0EB]"
              >
                Nobody, this is extra
              </button>
            </div>
            <button type="button" onClick={() => setOpen("")} className="text-sm text-[#6B5D52] underline">
              Cancel
            </button>
          </div>
        ) : open === "instead" ? (
          <div>
            {coveringName && <p className="text-sm text-[#6B5D52]">Covering for {coveringName}</p>}
            <PickedUpForm
              location={view.locationName}
              bags={covering ? (notYet.find((p) => p.staffId === covering)?.bags ?? null) : null}
              busy={busy}
              label="Save, picked up"
              onSave={(v) => send("instead", v)}
              onCancel={() => setOpen("")}
            />
          </div>
        ) : (
          <button type="button" onClick={startInstead} className="w-full rounded-xl border-2 border-[#B5845A] bg-white text-[#9A7049] py-2.5 text-[15px] font-medium hover:bg-[#FFF3DF]">
            {view.people.length ? "I picked up the ice instead" : "I picked up the ice"}
          </button>
        )
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}
