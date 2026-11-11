"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { HandoffPanelRow, PostPanel, Requester } from "@/lib/team/shifts-db";
import { timeLabel } from "@/lib/team/clock-label";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";

class ConfirmNeeded extends Error {}

async function post(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  // 428: the person marked the event's day unavailable, so the admin confirms first.
  if (res.status === 428) throw new ConfirmNeeded(data.error ?? "They marked this day unavailable. Approve anyway?");
  if (!res.ok) throw new Error(data.error ?? "Could not save.");
  return data;
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<{ key: string; url: string; body: Record<string, unknown>; message: string } | null>(null);
  const run = async (key: string, url: string, body: Record<string, unknown>, done?: (d: Record<string, unknown>) => string) => {
    setBusy(key);
    setError("");
    setNote("");
    try {
      const d = await post(url, body);
      setConfirm(null);
      if (done) setNote(done(d));
      router.refresh();
    } catch (err) {
      if (err instanceof ConfirmNeeded) setConfirm({ key, url, body: { ...body, confirmUnavailable: true }, message: err.message });
      else setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy("");
    }
  };
  return { busy, error, note, run, confirm, setConfirm };
}

function RequesterList({ people, postId, spots, tz, run, busy, records, certs }: { people: Requester[]; postId: string; spots: number; tz: string; run: ReturnType<typeof useAction>["run"]; busy: string; records: Record<string, string>; certs: Record<string, string> }) {
  if (people.length === 0) return <p className="text-[15px] text-[#6B5D52] py-1">No requests yet.</p>;
  return (
    <ul className="divide-y divide-[#DDD5CC]">
      {people.map((r) => (
        <li key={r.staffId} className="py-2.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-[#2C2420]">
              {r.name}
              {r.unavailable && <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#FFF3DF] text-[#9A7049]">Unavailable</span>}
              {certs[r.staffId] && <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F6E3DC] text-[#A0412D]">{certs[r.staffId]}</span>}
            </p>
            <p className="text-xs text-[#6B5D52]">
              Asked {timeLabel(r.requestedAt, undefined, tz)} · {records[r.staffId] ?? `${r.eventsWorked} ${r.eventsWorked === 1 ? "event" : "events"} worked`}
            </p>
            {r.sameDay.length > 0 && <p className="text-xs text-[#9A7049]">Also that day: {r.sameDay.join("; ")}</p>}
            {r.onEvent && <p className="text-xs text-[#6B5D52]">Already on this event</p>}
          </div>
          {!r.onEvent && (
            <button
              type="button"
              disabled={!!busy || spots <= 0}
              onClick={() => run(`approve:${r.staffId}`, "/api/team/admin/shifts", { action: "approve", postId, staffId: r.staffId })}
              className="shrink-0 rounded-lg bg-[#8B9E7E] text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            >
              {busy === `approve:${r.staffId}` ? "Approving..." : "Approve"}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

const MARKET_CHOICES: [string, string][] = [
  ["dallas", "Dallas"],
  ["austin", "Austin"],
  ["houston", "Houston"],
  ["los_angeles", "Los Angeles"],
];

export default function ShiftPanel({
  sessionId,
  panel,
  handoffs,
  marketSource,
  timeZone,
  records = {},
  certs = {},
}: {
  sessionId: string;
  panel: PostPanel;
  handoffs: HandoffPanelRow[];
  marketSource: string | null;
  timeZone: string;
  records?: Record<string, string>; // reliability line per staff id
  certs?: Record<string, string>; // "TABC expired" per staff id, for the event's market
}) {
  const { busy, error, note, run, confirm, setConfirm } = useAction();
  const [market, setMarket] = useState(panel.market ?? "");
  const p = panel.post;
  const why = panel.hidden ? "Hidden events cannot be posted." : !panel.market ? "Set the market first." : panel.spotsOpen <= 0 ? "No open spots." : "";

  return (
    <div className="space-y-3">
      <section className={card}>
        <h2 className="font-heading text-base font-bold text-[#2C2420] mb-2">Market</h2>
        <div className="flex gap-2">
          <select value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Market" className="flex-1 min-w-0 rounded-xl border border-[#DDD5CC] bg-white px-3 py-2.5 text-[16px] text-[#2C2420]">
            {!panel.market && <option value="">No market yet</option>}
            {MARKET_CHOICES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!!busy || !market || market === panel.market}
            onClick={() => run("market", "/api/team/admin/market", { sessionId, market })}
            className="rounded-xl bg-[#B5845A] text-white px-4 py-2.5 font-medium disabled:opacity-40"
          >
            {busy === "market" ? "Saving..." : "Save"}
          </button>
        </div>
        <p className="text-xs text-[#A39585] mt-2">
          {marketSource === "admin"
            ? "Set by an admin."
            : marketSource === "auto"
              ? "Set from the event address. Times use this market's time zone."
              : marketSource === "none"
                ? "The address is not within 150 miles of a market. Pick one."
                : "Worked out from the address once it can be found on a map."}
        </p>
      </section>

      <section className={card}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <h2 className="font-heading text-base font-bold text-[#2C2420]">Open shift</h2>
          {p && <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#FFF3DF] text-[#9A7049]">Posted</span>}
        </div>
        {p ? (
          <>
            <p className="text-sm text-[#6B5D52] mb-2">
              Posted {timeLabel(p.posted_at, undefined, timeZone)} · {panel.spotsOpen} {panel.spotsOpen === 1 ? "spot" : "spots"} open. Approve up to {panel.spotsOpen}. Approved staff are accepted right away.
            </p>
            <RequesterList people={panel.requesters} postId={p.id} spots={panel.spotsOpen} tz={timeZone} run={run} busy={busy} records={records} certs={certs} />
            <button type="button" disabled={!!busy} onClick={() => run("unpost", "/api/team/admin/shifts", { action: "unpost", postId: p.id })} className="text-sm text-[#A0412D] underline mt-2 disabled:opacity-40">
              {busy === "unpost" ? "Unposting..." : "Unpost"}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-[#6B5D52] mb-2">Post the open spots to every active bartender in this market. They get a text and can request it.</p>
            <button
              type="button"
              disabled={!!busy || !!why}
              onClick={() => run("post", "/api/team/admin/shifts", { action: "post", sessionId }, (d) => String(d.message ?? "Posted."))}
              className="rounded-xl bg-[#B5845A] text-white px-4 py-2.5 font-medium disabled:opacity-40"
            >
              {busy === "post" ? "Posting..." : `Post shift${panel.spotsOpen > 0 ? ` (${panel.spotsOpen} ${panel.spotsOpen === 1 ? "spot" : "spots"})` : ""}`}
            </button>
            {why && <p className="text-xs text-[#A39585] mt-1">{why}</p>}
          </>
        )}
      </section>

      {handoffs.map((h) => (
        <section key={h.id} className={`${card} ${h.urgent ? "border-[#A0412D]" : ""}`}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <h2 className="font-heading text-base font-bold text-[#2C2420]">Handoff</h2>
            {h.urgent && <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F6E3DC] text-[#A0412D]">Urgent</span>}
          </div>
          <p className="text-[15px] text-[#2C2420]">
            {h.fromName} wants to give up this shift: &ldquo;{h.reason}&rdquo;
          </p>
          {records[h.fromStaffId] && <p className="text-xs text-[#6B5D52]">{h.fromName.split(" ")[0]}: {records[h.fromStaffId]}</p>}
          {h.teammateStaffId && records[h.teammateStaffId] && <p className="text-xs text-[#6B5D52]">{h.teammateName.split(" ")[0]}: {records[h.teammateStaffId]}</p>}
          {h.teammateStaffId && certs[h.teammateStaffId] && <p className="text-xs text-[#A0412D]">{h.teammateName.split(" ")[0]}: {certs[h.teammateStaffId]}</p>}
          <p className="text-sm text-[#6B5D52]">
            {h.mode === "teammate"
              ? h.status === "asked"
                ? `Offered to ${h.teammateName}. Waiting for their answer.`
                : `${h.teammateName}${h.teammateUnavailable ? " (Unavailable that day)" : ""} accepted. Approve to move the shift to them.`
              : "Cover needed: open to the market. Approve one person who asked."}{" "}
            {h.fromName.split(" ")[0]} stays on the shift until you approve.
          </p>
          {h.mode === "market" && h.postId && <div className="mt-2"><RequesterList people={h.requesters} postId={h.postId} spots={1} tz={timeZone} run={run} busy={busy} records={records} certs={certs} /></div>}
          <div className="flex flex-wrap gap-3 mt-2">
            {h.mode === "teammate" && h.status === "teammate_accepted" && (
              <button type="button" disabled={!!busy} onClick={() => run(`ha:${h.id}`, "/api/team/admin/handoff", { action: "approve", handoffId: h.id })} className="rounded-lg bg-[#8B9E7E] text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40">
                {busy === `ha:${h.id}` ? "Approving..." : `Approve ${h.teammateName.split(" ")[0]}`}
              </button>
            )}
            <button type="button" disabled={!!busy} onClick={() => run(`hd:${h.id}`, "/api/team/admin/handoff", { action: "decline", handoffId: h.id })} className="rounded-lg border border-[#A0412D] text-[#A0412D] px-3 py-1.5 text-sm font-medium disabled:opacity-40">
              {busy === `hd:${h.id}` ? "Declining..." : "Decline handoff"}
            </button>
          </div>
        </section>
      ))}
      {confirm && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E8C9A8] bg-[#FFF3DF] px-3 py-2">
          <span className="text-sm text-[#2C2420]">{confirm.message}</span>
          <button type="button" disabled={!!busy} onClick={() => run(confirm.key, confirm.url, confirm.body)} className="rounded-lg bg-[#8B9E7E] text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40">
            {busy ? "Approving..." : "Approve anyway"}
          </button>
          <button type="button" onClick={() => setConfirm(null)} className="text-sm text-[#6B5D52] underline">
            Cancel
          </button>
        </div>
      )}
      {note && <p className="text-sm text-[#55684A] px-1">{note}</p>}
      {error && <p className="text-sm text-[#A0412D] px-1">{error}</p>}
    </div>
  );
}
