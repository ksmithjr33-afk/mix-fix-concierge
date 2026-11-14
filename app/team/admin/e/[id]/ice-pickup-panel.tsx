"use client";

import { useState } from "react";
import type { IceView, Place } from "@/lib/team/ice-pickup-db";
import { field, IceStateBadge, PersonStatus, PickedUpForm, postIce } from "../../../ice-pickup-card";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";
const small = "w-20 rounded-lg border border-[#DDD5CC] bg-white px-2 py-1.5 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]";

/**
 * The manager view's "Ice pickup" card, under Menu pickup: the recommended
 * location (free text, with locations used before to tap and reuse), total
 * bags (from the Shopping list's ice when it is calculated, editable), notes,
 * and who is picking up with optional bag counts. Each person's status, with
 * Mark picked up and Undo for anyone. Any active staff member or admin can be
 * picked, on the event or not.
 */
export default function IcePickupPanel({ initial, people, places }: { initial: IceView; people: { id: string; name: string; role: string }[]; places: Place[] }) {
  const [view, setView] = useState(initial);
  const [name, setName] = useState(initial.locationName);
  const [address, setAddress] = useState(initial.locationAddress);
  const [total, setTotal] = useState(initial.savedTotal !== null ? String(initial.savedTotal) : initial.listBags !== null ? String(initial.listBags) : "");
  const [notes, setNotes] = useState(initial.notes);
  const [pick, setPick] = useState("");
  const [pickBags, setPickBags] = useState("");
  const [bagEdits, setBagEdits] = useState<Record<string, string>>({});
  const [marking, setMarking] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const run = async (what: string, body: Record<string, unknown>, done?: string) => {
    setBusy(what);
    setError("");
    setSaved("");
    try {
      const v = await postIce(view.sessionId, body);
      setView(v);
      if (done) setSaved(done);
      return v;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      return null;
    } finally {
      setBusy("");
    }
  };

  const savedTotal = view.savedTotal !== null ? String(view.savedTotal) : view.listBags !== null ? String(view.listBags) : "";
  const dirty = name !== view.locationName || address !== view.locationAddress || total !== savedTotal || notes !== view.notes || (view.savedTotal === null && total !== "");
  const assigned = new Set(view.people.map((p) => p.staffId));
  const choices = people.filter((p) => !assigned.has(p.id));
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "";
  const reuse = places.filter((p) => p.name.toLowerCase() !== name.trim().toLowerCase());

  return (
    <section className={`${card} space-y-3`} aria-label="Ice pickup">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-heading text-base font-bold text-[#2C2420]">Ice pickup</h3>
        <IceStateBadge view={view} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-[#A39585] uppercase tracking-wide">
          Recommended location
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={`${field} mt-1`} placeholder="e.g. Kroger on Lemmon Ave" />
        </label>
        <label className="block text-xs text-[#A39585] uppercase tracking-wide">
          Address (optional)
          <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} className={`${field} mt-1`} />
        </label>
        {reuse.length > 0 && (
          <div className="sm:col-span-2 -mt-1">
            <p className="text-xs text-[#A39585] uppercase tracking-wide mb-1">Used before</p>
            <div className="flex flex-wrap gap-1.5">
              {reuse.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => {
                    setName(p.name);
                    setAddress(p.address);
                  }}
                  className="rounded-full border border-[#DDD5CC] bg-white px-3 py-1 text-sm text-[#2C2420] hover:border-[#B5845A]"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="block text-xs text-[#A39585] uppercase tracking-wide">
          Total bags (optional)
          <input value={total} onChange={(e) => setTotal(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" className={`${field} mt-1`} />
          {view.listBags !== null && <span className="mt-1 block normal-case tracking-normal text-[13px] text-[#6B5D52]">Shopping list: {view.listBags} bags</span>}
        </label>
        <label className="block text-xs text-[#A39585] uppercase tracking-wide">
          Notes (optional)
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className={`${field} mt-1`} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => run("save", { action: "save", location_name: name, location_address: address, total_bags: total, notes }, "Saved.")}
          disabled={!!busy || !dirty}
          className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {busy === "save" ? "Saving..." : "Save"}
        </button>
        {saved && <span className="text-sm text-[#55684A]">{saved}</span>}
      </div>

      <div className="border-t border-[#DDD5CC] pt-3 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-xs text-[#A39585] uppercase tracking-wide">Who is picking up ice</p>
          {view.bagLine && <p className="text-sm text-[#6B5D52]">{view.bagLine}</p>}
        </div>
        {view.bagWarning && <p className="rounded-lg bg-[#F6E3DC] px-3 py-2 text-sm text-[#A0412D]">{view.bagWarning}</p>}
        {view.people.length === 0 && <p className="text-sm text-[#6B5D52]">No one yet.</p>}
        <ul className="space-y-2">
          {view.people.map((p) => {
            const edit = bagEdits[p.staffId] ?? (p.bagsSet === null ? "" : String(p.bagsSet));
            const changed = edit !== (p.bagsSet === null ? "" : String(p.bagsSet));
            return (
              <li key={p.staffId} className="rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="text-[15px] font-medium text-[#2C2420]">
                    {p.name}
                    {p.selfAdded && <span className="font-normal text-[#6B5D52]"> (added themselves)</span>}
                  </span>
                  <label className="flex items-center gap-1.5 text-sm text-[#6B5D52]">
                    Bags
                    <input
                      value={edit}
                      onChange={(e) => setBagEdits((m) => ({ ...m, [p.staffId]: e.target.value.replace(/\D/g, "").slice(0, 3) }))}
                      inputMode="numeric"
                      className={small}
                      aria-label={`Bags for ${p.name}`}
                    />
                  </label>
                  {changed && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (await run(`bags:${p.staffId}`, { action: "assign", staffId: p.staffId, bags: edit }, `Saved. ${p.name} gets a text if their bags changed.`)) {
                          setBagEdits((m) => {
                            const rest = { ...m };
                            delete rest[p.staffId];
                            return rest;
                          });
                        }
                      }}
                      disabled={!!busy}
                      className="text-sm font-medium text-[#9A7049] underline disabled:opacity-40"
                    >
                      {busy === `bags:${p.staffId}` ? "Saving..." : "Save bags"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => run(`remove:${p.staffId}`, { action: "remove", staffId: p.staffId })}
                    disabled={!!busy}
                    className="ml-auto text-sm text-[#A0412D] underline disabled:opacity-40"
                  >
                    {busy === `remove:${p.staffId}` ? "Removing..." : "Remove"}
                  </button>
                </div>
                <PersonStatus p={p} />
                {p.pickedUp ? (
                  <button type="button" onClick={() => run(`undo:${p.staffId}`, { action: "undo", staffId: p.staffId })} disabled={!!busy} className="text-sm text-[#6B5D52] underline disabled:opacity-40">
                    {busy === `undo:${p.staffId}` ? "Undoing..." : "Undo"}
                  </button>
                ) : marking === p.staffId ? (
                  <PickedUpForm
                    location={view.locationName}
                    bags={p.bags}
                    busy={busy === `mark:${p.staffId}`}
                    label={`Mark ${p.name} picked up`}
                    onSave={async (v) => {
                      if (await run(`mark:${p.staffId}`, { action: "picked_up", staffId: p.staffId, location: v.location, bags: v.bags })) setMarking("");
                    }}
                    onCancel={() => setMarking("")}
                  />
                ) : (
                  <button type="button" onClick={() => setMarking(p.staffId)} disabled={!!busy} className="text-sm font-medium text-[#55684A] underline disabled:opacity-40">
                    Mark picked up
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block flex-1 min-w-[12rem] text-xs text-[#A39585] uppercase tracking-wide">
            Add a person
            <select value={pick} onChange={(e) => setPick(e.target.value)} className={`${field} mt-1`}>
              <option value="">Pick someone</option>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.role === "admin" ? " (admin)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[#A39585] uppercase tracking-wide">
            Bags (optional)
            <input value={pickBags} onChange={(e) => setPickBags(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" className={`${field} mt-1 !w-24`} />
          </label>
          <button
            type="button"
            onClick={async () => {
              const who = nameOf(pick);
              if (await run("assign", { action: "assign", staffId: pick, bags: pickBags }, `Added. ${who.split(/\s+/)[0]} gets a text.`)) {
                setPick("");
                setPickBags("");
              }
            }}
            disabled={!!busy || !pick}
            className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {busy === "assign" ? "Adding..." : "Add"}
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}
