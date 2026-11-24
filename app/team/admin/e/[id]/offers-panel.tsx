"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OffersPanel as Data } from "@/lib/team/scorecard-offers-db";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";
const btn = "min-h-[44px] rounded-lg border border-[#DDD5CC] bg-white px-3 text-sm text-[#2C2420] disabled:opacity-40";

const TONE: Record<string, string> = {
  accepted: "bg-[#E4EBDF] text-[#55684A]",
  held: "bg-[#FFF3DF] text-[#9A7049]",
  sent: "bg-[#FFF3DF] text-[#9A7049]",
  declined: "bg-[#F6E3DC] text-[#A0412D]",
  no_response: "bg-[#F6E3DC] text-[#A0412D]",
  released: "bg-[#EFE8E0] text-[#6B5D52]",
  skipped: "bg-[#EFE8E0] text-[#6B5D52]",
  closed: "bg-[#EFE8E0] text-[#6B5D52]",
  planned: "bg-white text-[#6B5D52] border border-[#DDD5CC]",
};

const RUN_LABEL: Record<string, string> = { running: "Running", paused: "Paused", stopped: "Stopped", filled: "Filled", exhausted: "Out of people" };

/**
 * Shift offers on the Team tab: the planned order before anything is sent,
 * then who was offered and when, who is next and at what time, who declined,
 * who did not respond, and who accepted. Assign by hand above always works and
 * ends the offers for that spot.
 */
export default function OffersPanel({ sessionId, data }: { sessionId: string; data: Data }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [showSkipped, setShowSkipped] = useState(false);

  const act = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setError("");
    try {
      const res = await fetch("/api/team/admin/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy("");
    }
  };

  const run = data.run;
  const live = run && (run.run.status === "running" || run.run.status === "paused");

  return (
    <section className={card} aria-label="Shift offers">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Shift offers</h2>
        <span className="text-xs text-[#A39585]">
          {data.market ? `${data.market}: ${data.modeLabel}` : "No market"}
          {run ? ` · ${RUN_LABEL[run.run.status] ?? run.run.status}` : ""}
        </span>
      </div>

      {data.noCount && (
        <p className="rounded-xl bg-[#FFF8EC] border border-[#E3C9A0] px-3 py-2 text-sm text-[#2C2420] mb-2">
          No bartender count on file. Set it above so offers can start{data.mode === "automatic" ? " on their own" : ""}.
        </p>
      )}
      {data.posted && !live && <p className="text-sm text-[#6B5D52] mb-2">This shift is posted, so offers are not used. Unpost it to send offers instead.</p>}
      {data.mode === "off" && !run && <p className="text-sm text-[#6B5D52]">Offers are off for this market. Post the shift or assign by hand.</p>}

      {error && <p className="rounded-xl bg-[#F6E3DC] text-[#A0412D] px-3 py-2 text-sm mb-2">{error}</p>}

      {run && (
        <div className="space-y-2">
          <p className="text-sm text-[#6B5D52]">
            Started {run.startedAt} by {run.run.started_by_name ?? "an admin"}. {run.open} of {run.run.spots} {run.run.spots === 1 ? "spot" : "spots"} open.
            {run.run.alerted_at ? ` Admins were texted: ${run.run.alert_reason}.` : ""}
          </p>
          {run.next && (
            <p className="text-[15px] text-[#2C2420]">
              Next: <strong>{run.next.name}</strong> at {run.nextAt}
            </p>
          )}
          {run.held.map((h) => (
            <div key={h.id} className="rounded-xl bg-[#FFF3DF] px-3 py-2 space-y-2">
              <p className="text-[15px] text-[#2C2420]">
                <strong>{h.name}</strong> accepted and is waiting for you{h.note ? ` (${h.note})` : ""}.
              </p>
              <div className="flex gap-2">
                <button type="button" disabled={!!busy} onClick={() => act(`c-${h.id}`, { action: "confirm", stepId: h.id })} className={`${btn} !bg-[#55684A] !text-white !border-[#55684A]`}>
                  {busy === `c-${h.id}` ? "Confirming..." : "Confirm"}
                </button>
                <button type="button" disabled={!!busy} onClick={() => act(`r-${h.id}`, { action: "release", stepId: h.id })} className={btn}>
                  Release
                </button>
              </div>
            </div>
          ))}
          <ol className="divide-y divide-[#DDD5CC]">
            {run.steps.map((s, i) => {
              const l = run.lines[i];
              const when = s.status === "planned" ? (l.due ? `Planned ${l.due}` : "") : [l.sent && `Offered ${l.sent}`, l.responded && `Answered ${l.responded}`].filter(Boolean).join(" · ");
              return (
                <li key={s.id} className="py-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[#A39585] w-24 shrink-0">{s.self ? "You" : `${s.group} ${s.rank}`}</span>
                  <span className="text-[15px] text-[#2C2420] flex-1 min-w-[8rem]">{s.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${TONE[s.status] ?? ""}`}>{s.label}</span>
                  {live && (s.status === "planned" || s.status === "sent") && (
                    <button type="button" disabled={!!busy} onClick={() => act(`s-${s.id}`, { action: "skip", stepId: s.id })} className="text-xs text-[#A0412D] underline px-1 min-h-[44px]">
                      Skip
                    </button>
                  )}
                  {(when || s.note) && <span className="basis-full text-xs text-[#6B5D52] pl-0 sm:pl-26">{[when, s.note].filter(Boolean).join(" · ")}</span>}
                </li>
              );
            })}
          </ol>
          {live && (
            <div className="flex flex-wrap gap-2 pt-1">
              {run.run.status === "running" ? (
                <button type="button" disabled={!!busy} onClick={() => act("pause", { action: "pause", runId: run.run.id })} className={btn}>
                  Pause
                </button>
              ) : (
                <button type="button" disabled={!!busy} onClick={() => act("resume", { action: "resume", runId: run.run.id })} className={btn}>
                  Resume
                </button>
              )}
              <button type="button" disabled={!!busy} onClick={() => act("stop", { action: "stop", runId: run.run.id })} className={`${btn} !text-[#A0412D]`}>
                Stop offers
              </button>
            </div>
          )}
        </div>
      )}

      {data.plan && (
        <div className={`space-y-2 ${run ? "mt-4 pt-3 border-t border-[#DDD5CC]" : ""}`}>
          {data.plan.block ? (
            <p className="text-sm text-[#6B5D52]">{data.plan.block}</p>
          ) : (
            <>
              <p className="text-sm text-[#6B5D52]">
                Planned order for {data.plan.spots} open {data.plan.spots === 1 ? "spot" : "spots"} if sent now. The first to accept gets a spot.
              </p>
              <ol className="divide-y divide-[#DDD5CC]">
                {data.plan.order.map((o) => (
                  <li key={o.staffId} className="py-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-[#A39585] w-24 shrink-0">{o.group ? `${o.group} ${o.rank}` : "You"}</span>
                    <span className="text-[15px] text-[#2C2420] flex-1">{o.name}</span>
                    <span className="text-xs text-[#6B5D52]">{o.at}</span>
                  </li>
                ))}
              </ol>
              <button type="button" disabled={!!busy} onClick={() => act("start", { action: "start", sessionId })} className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40">
                {busy === "start" ? "Sending..." : "Send offers"}
              </button>
            </>
          )}
          {data.plan.skipped.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowSkipped((v) => !v)} className="text-sm text-[#6B5D52] underline min-h-[44px]">
                {showSkipped ? "Hide" : "Show"} {data.plan.skipped.length} skipped
              </button>
              {showSkipped && (
                <ul className="text-sm text-[#6B5D52] space-y-0.5">
                  {data.plan.skipped.map((s, i) => (
                    <li key={i}>
                      {s.name}: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
