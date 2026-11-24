"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Board, BoardPerson, HistoryLine } from "@/lib/team/scorecard-ranks-db";
import { offersSave } from "./save";

const card = "rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3";
const btn = "min-h-[44px] min-w-[44px] rounded-lg border border-[#DDD5CC] bg-white px-3 text-[15px] text-[#2C2420] disabled:opacity-30";
const input = "w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2.5 text-[16px] text-[#2C2420]";
const MODES = [
  { key: "off", label: "Off" },
  { key: "suggest", label: "Suggest" },
  { key: "automatic", label: "Automatic" },
] as const;

const post = offersSave;

export default function OfferBoard({ board }: { board: Board }) {
  const router = useRouter();
  const [market, setMarket] = useState(board.markets[0]?.market ?? "dallas");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const m = board.markets.find((x) => x.market === market) ?? board.markets[0];

  const act = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setError("");
    try {
      await post(body);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy("");
    }
  };

  const saveMode = (mode: string) =>
    act(`mode-${mode}`, {
      action: "settings",
      headStartMin: board.settings.headStartMin,
      windowMin: board.settings.windowMin,
      startDaysBefore: board.settings.startDaysBefore,
      assignOnAccept: board.settings.assignOnAccept,
      modes: { [market]: mode },
    });

  const all = m.tiers.flatMap((t) => t.people);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Market">
        {board.markets.map((x) => (
          <button
            key={x.market}
            type="button"
            role="tab"
            aria-selected={x.market === market}
            onClick={() => setMarket(x.market)}
            className={`min-h-[44px] rounded-full px-4 text-sm ${x.market === market ? "bg-[#2C2420] text-white" : "bg-[#EFE8E0] text-[#2C2420]"}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      <section className={card} aria-label="Mode">
        <p className="text-xs uppercase tracking-wide text-[#A39585] mb-1">{m.label}: offers mode</p>
        <div className="flex flex-wrap gap-2">
          {MODES.map((x) => {
            const locked = x.key === "automatic" && !m.reviewed;
            return (
              <button
                key={x.key}
                type="button"
                disabled={!board.canEdit || locked || !!busy}
                onClick={() => saveMode(x.key)}
                className={`${btn} ${m.mode === x.key ? "!bg-[#B5845A] !text-white !border-[#B5845A]" : ""}`}
                title={locked ? 'Tap "Order reviewed" first' : undefined}
              >
                {x.label}
              </button>
            );
          })}
        </div>
        <p className="text-sm text-[#6B5D52] mt-2">
          {m.mode === "off" && "No offers in this market. Posting shifts works as before."}
          {m.mode === "suggest" && "The event's Team tab shows the planned order. An admin sends offers with one tap."}
          {m.mode === "automatic" && `Offers start on their own ${board.settings.startDaysBefore} days before an event that needs bartenders.`}
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          {board.canEdit && (
            <button type="button" disabled={!!busy} onClick={() => act("reviewed", { action: "reviewed", market })} className={btn}>
              {busy === "reviewed" ? "Saving..." : "Order reviewed"}
            </button>
          )}
          <span className="text-sm text-[#6B5D52]">
            {m.reviewed ? `Reviewed by ${m.reviewed.by}, ${new Date(m.reviewed.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "Not reviewed yet. Automatic stays locked until it is."}
          </span>
        </div>
      </section>

      {error && <p className="rounded-xl bg-[#F6E3DC] text-[#A0412D] px-4 py-2 text-sm">{error}</p>}

      {m.tiers.map((t) => (
        <section key={t.tier} className="space-y-2" aria-label={t.label}>
          <h2 className="px-1 font-heading text-lg font-bold text-[#2C2420]">
            {t.label} <span className="text-sm font-normal text-[#A39585]">({t.people.length})</span>
          </h2>
          {t.people.length === 0 ? (
            <p className={`${card} text-sm text-[#6B5D52]`}>Nobody in {t.label} for {m.label}.</p>
          ) : (
            <ol className="space-y-2">
              {t.people.map((p) => (
                <PersonRow
                  key={p.staffId}
                  p={p}
                  canEdit={board.canEdit}
                  busy={busy}
                  first={all[0]?.staffId === p.staffId}
                  last={all[all.length - 1]?.staffId === p.staffId}
                  act={act}
                  market={market}
                />
              ))}
            </ol>
          )}
        </section>
      ))}

      <Settings board={board} canEdit={board.canEdit} />

      <section className={card} aria-label="Admins and managers who bartend">
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Include in bartender offers</h2>
        <p className="text-sm text-[#6B5D52] mb-2">Admins and managers who also bartend events. Off by default. Once on, they are ranked like anyone else. Bartenders are always included.</p>
        {board.optional.length === 0 ? (
          <p className="text-sm text-[#6B5D52]">No other admins or managers.</p>
        ) : (
          <ul className="divide-y divide-[#DDD5CC]">
            {board.optional.map((o) => (
              <li key={o.staffId} className="flex items-center justify-between gap-3 py-2">
                <span className="text-[15px] text-[#2C2420]">
                  {o.name} <span className="text-xs text-[#A39585]">{o.role}</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={o.on}
                  disabled={!board.canEdit || !!busy}
                  onClick={() => act(`inc-${o.staffId}`, { action: "include", staffId: o.staffId, on: !o.on })}
                  className={`${btn} ${o.on ? "!bg-[#55684A] !text-white !border-[#55684A]" : ""}`}
                >
                  {o.on ? "On" : "Off"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {!board.canEdit && <p className="px-1 text-sm text-[#6B5D52]">Managers can view the order. Only admins can change it.</p>}
    </div>
  );
}

function PersonRow({
  p,
  canEdit,
  busy,
  first,
  last,
  act,
  market,
}: {
  p: BoardPerson;
  canEdit: boolean;
  busy: string;
  first: boolean;
  last: boolean;
  act: (key: string, body: Record<string, unknown>) => Promise<void>;
  market: string;
}) {
  const [editing, setEditing] = useState(false);
  const [solo, setSolo] = useState(p.solo === null ? "" : String(p.solo));
  const [weddings, setWeddings] = useState(p.weddings);
  const [note, setNote] = useState(p.note);
  const [hist, setHist] = useState<HistoryLine[] | null>(null);
  const [histErr, setHistErr] = useState("");

  const loadHistory = async () => {
    if (hist) return setHist(null);
    try {
      const d = await post({ action: "history", staffId: p.staffId });
      setHist((d.lines as HistoryLine[]) ?? []);
    } catch (err) {
      setHistErr(err instanceof Error ? err.message : "Could not load.");
    }
  };

  return (
    <li className={card}>
      <div className="flex items-start gap-3">
        <span className="font-heading text-lg font-bold text-[#B5845A] w-7 shrink-0 text-right">{p.place}</span>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[#2C2420]">
            {p.name}
            {p.roleNote && <span className="ml-2 text-xs text-[#A39585]">{p.roleNote}</span>}
            {!p.placed && <span className="ml-2 rounded-full bg-[#FFF3DF] text-[#9A7049] px-2 py-0.5 text-xs">Not placed yet</span>}
          </p>
          {p.payWarning && <p className="text-sm text-[#A0412D]">{p.payWarning}</p>}
          <p className="text-sm text-[#2C2420]">{p.line}</p>
          <p className="text-sm text-[#6B5D52]">
            Solo guests: {p.solo ?? "no limit"} · Weddings: {p.weddings ? "yes" : "no"}
            {p.daysOff ? ` · ${p.daysOff}` : ""}
          </p>
          {p.note && <p className="text-sm text-[#6B5D52] break-words">{p.note}</p>}
          {p.updated && <p className="text-xs text-[#A39585]">{p.updated}</p>}
        </div>
        {canEdit && (
          <div className="flex flex-col gap-1 shrink-0">
            <button type="button" aria-label={`Move ${p.name} up`} disabled={first || !!busy} onClick={() => act(`up-${p.staffId}`, { action: "move", staffId: p.staffId, dir: "up", market })} className={btn}>
              ▲
            </button>
            <button type="button" aria-label={`Move ${p.name} down`} disabled={last || !!busy} onClick={() => act(`down-${p.staffId}`, { action: "move", staffId: p.staffId, dir: "down", market })} className={btn}>
              ▼
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        {canEdit && (
          <select
            aria-label={`Tier for ${p.name}`}
            value={p.tier}
            disabled={!!busy}
            onChange={(e) => act(`tier-${p.staffId}`, { action: "tier", staffId: p.staffId, tier: e.target.value })}
            className="min-h-[44px] rounded-lg border border-[#DDD5CC] bg-white px-2 text-[15px]"
          >
            <option value="top">Top</option>
            <option value="core">Core</option>
            <option value="developing">Developing</option>
          </select>
        )}
        {canEdit && (
          <button type="button" className={btn} onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </button>
        )}
        <button type="button" className={btn} onClick={loadHistory}>
          {hist ? "Hide history" : "History"}
        </button>
      </div>
      {editing && (
        <div className="mt-3 space-y-2">
          <label className="block text-sm text-[#6B5D52]">
            Solo guests (blank for no limit)
            <input inputMode="numeric" value={solo} onChange={(e) => setSolo(e.target.value)} className={input} />
          </label>
          <div className="flex gap-2 items-center">
            <span className="text-sm text-[#6B5D52]">Weddings</span>
            <button type="button" onClick={() => setWeddings(true)} className={`${btn} ${weddings ? "!bg-[#55684A] !text-white" : ""}`}>
              Yes
            </button>
            <button type="button" onClick={() => setWeddings(false)} className={`${btn} ${!weddings ? "!bg-[#A0412D] !text-white" : ""}`}>
              No
            </button>
          </div>
          <label className="block text-sm text-[#6B5D52]">
            Note
            <input value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} className={input} />
          </label>
          <button
            type="button"
            disabled={!!busy}
            onClick={async () => {
              await act(`edit-${p.staffId}`, { action: "edit", staffId: p.staffId, solo, weddings, note });
              setEditing(false);
            }}
            className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            Save
          </button>
        </div>
      )}
      {histErr && <p className="text-sm text-[#A0412D] mt-2">{histErr}</p>}
      {hist && (
        <ul className="mt-2 text-sm text-[#6B5D52] space-y-0.5">
          {hist.length === 0 ? <li>No changes yet.</li> : hist.map((h, i) => <li key={i}>{`${h.at}: ${h.what} (${h.by})`}</li>)}
        </ul>
      )}
    </li>
  );
}

function Settings({ board, canEdit }: { board: Board; canEdit: boolean }) {
  const router = useRouter();
  const s = board.settings;
  const [headStartMin, setHead] = useState(String(s.headStartMin));
  const [windowHours, setWindow] = useState(String(s.windowMin / 60));
  const [startDaysBefore, setDays] = useState(String(s.startDaysBefore));
  const [assignOnAccept, setAssign] = useState(s.assignOnAccept);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const save = async () => {
    setBusy(true);
    setMsg("");
    try {
      await post({ action: "settings", headStartMin: Number(headStartMin), windowMin: Math.round(Number(windowHours) * 60), startDaysBefore: Number(startDaysBefore), assignOnAccept });
      setMsg("Saved.");
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card} aria-label="Offer settings">
      <h2 className="font-heading text-base font-bold text-[#2C2420]">Offer settings</h2>
      <p className="text-sm text-[#6B5D52] mb-2">Only daytime counts: 9 AM to 8 PM in the event&apos;s market. No offer goes out in quiet hours.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-sm text-[#6B5D52]">
          Head start between ranks (daytime minutes)
          <input inputMode="numeric" disabled={!canEdit} value={headStartMin} onChange={(e) => setHead(e.target.value)} className={input} />
        </label>
        <label className="text-sm text-[#6B5D52]">
          Window per tier (daytime hours)
          <input inputMode="decimal" disabled={!canEdit} value={windowHours} onChange={(e) => setWindow(e.target.value)} className={input} />
        </label>
        <label className="text-sm text-[#6B5D52]">
          Automatic: start offers this many days before the event
          <input inputMode="numeric" disabled={!canEdit} value={startDaysBefore} onChange={(e) => setDays(e.target.value)} className={input} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <span className="text-sm text-[#6B5D52]">Assign on accept</span>
        <button type="button" disabled={!canEdit} onClick={() => setAssign(true)} className={`${btn} ${assignOnAccept ? "!bg-[#55684A] !text-white" : ""}`}>
          Yes
        </button>
        <button type="button" disabled={!canEdit} onClick={() => setAssign(false)} className={`${btn} ${!assignOnAccept ? "!bg-[#A0412D] !text-white" : ""}`}>
          No
        </button>
      </div>
      <p className="text-xs text-[#A39585] mt-1">
        Weddings, events over {s.holdOverGuests} guests, and a team that would be all Developing always wait for an admin to confirm.
      </p>
      {canEdit && (
        <div className="flex items-center gap-3 mt-3">
          <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
            {busy ? "Saving..." : "Save settings"}
          </button>
          {msg && <span className="text-sm text-[#6B5D52]">{msg}</span>}
        </div>
      )}
    </section>
  );
}
