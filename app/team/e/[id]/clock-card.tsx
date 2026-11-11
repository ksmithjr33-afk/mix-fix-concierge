"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClockView } from "@/lib/team/clock-db";
import { FLAG_LABELS, formatWorked, type PunchFlag } from "@/lib/team/clock";
import { timeLabel } from "@/lib/team/clock-label";

// Punches that could not reach us are kept on the phone and sent when there is
// signal. Each has a clientId, so a retry that did get through is never saved twice.
const QUEUE_KEY = "mf_punch_queue";

interface QueuedPunch {
  clientId: string;
  sessionId: string;
  type: "in" | "out";
  clientTime: string;
  location: { lat: number; lng: number; accuracy: number | null } | null;
}

function readQueue(): QueuedPunch[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const list = raw ? (JSON.parse(raw) as QueuedPunch[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeQueue(list: QueuedPunch[]) {
  try {
    if (list.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(list));
    else localStorage.removeItem(QUEUE_KEY);
  } catch {
    // storage blocked: the punch stays in memory for this visit only
  }
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

/** The phone's location, or null if it is off, refused, or too slow. */
function getLocation(): Promise<QueuedPunch["location"]> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  });
}

type SendResult = { kind: "saved"; clock: ClockView } | { kind: "refused"; error: string } | { kind: "offline" };

async function send(p: QueuedPunch): Promise<SendResult> {
  try {
    const res = await fetch("/api/team/punch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { kind: "saved", clock: data.clock };
    if (res.status >= 500) return { kind: "offline" };
    return { kind: "refused", error: data.error ?? "Could not save." };
  } catch {
    return { kind: "offline" };
  }
}

function Flags({ flags }: { flags: PunchFlag[] }) {
  if (!flags.length) return null;
  return (
    <span className="flex flex-wrap gap-1 mt-0.5">
      {flags.map((f) => (
        <span key={f} className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-[#FFF3DF] text-[#9A7049]">
          {FLAG_LABELS[f] ?? f}
        </span>
      ))}
    </span>
  );
}

export default function ClockCard({ sessionId, initial, renderedAt, wrapUp }: { sessionId: string; initial: ClockView; renderedAt: number; wrapUp?: () => void }) {
  const [clock, setClock] = useState(initial);
  const [queued, setQueued] = useState<QueuedPunch[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(renderedAt); // the server render time first, so the first paint matches

  const flush = useCallback(async () => {
    let list = readQueue();
    const mine = list.filter((p) => p.sessionId === sessionId);
    for (const p of mine) {
      const r = await send(p);
      if (r.kind === "offline") break; // still no signal, keep the rest in order
      list = list.filter((q) => q.clientId !== p.clientId);
      writeQueue(list);
      if (r.kind === "saved") setClock(r.clock);
      else setError(r.error);
    }
    setQueued(readQueue().filter((p) => p.sessionId === sessionId));
  }, [sessionId]);

  useEffect(() => {
    // Send anything left on the phone from an earlier visit, then keep trying.
    const first = setTimeout(() => void flush(), 0);
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    const retry = setInterval(() => void flush(), 30_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearTimeout(first);
      clearInterval(retry);
      clearInterval(tick);
    };
  }, [flush]);

  const punch = async (type: "in" | "out") => {
    setBusy(true);
    setError("");
    setConfirmOut(false);
    const p: QueuedPunch = { clientId: newId(), sessionId, type, clientTime: new Date().toISOString(), location: await getLocation() };
    const r = await send(p);
    if (r.kind === "saved") setClock(r.clock);
    else if (r.kind === "refused") setError(r.error);
    else {
      writeQueue([...readQueue(), p]);
      setQueued(readQueue().filter((q) => q.sessionId === sessionId));
    }
    setBusy(false);
  };

  const pendingIn = queued.find((p) => p.type === "in");
  const pendingOut = queued.find((p) => p.type === "out");
  const clockedIn = clock.clockIn ?? (pendingIn ? { at: pendingIn.clientTime, flags: [] as PunchFlag[], distance: null } : null);
  const clockedOut = clock.clockOut ?? (pendingOut ? { at: pendingOut.clientTime, flags: [] as PunchFlag[], distance: null } : null);
  const opensAt = clock.opensAt ? new Date(clock.opensAt).getTime() : null;
  const open = opensAt === null || now >= opensAt;

  if (!clock.canPunch) return null;

  return (
    <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Time clock</h2>
        {clock.workedMinutes !== null && <span className="text-sm font-medium text-[#2C2420] tabular-nums">{formatWorked(clock.workedMinutes)}</span>}
      </div>

      {(clockedIn || clockedOut) && (
        <ul className="space-y-1.5 text-[15px] text-[#2C2420]">
          {clockedIn && (
            <li>
              Clocked in {timeLabel(clockedIn.at, undefined, clock.timeZone)}
              {pendingIn && <span className="text-sm text-[#9A7049]"> (saved on your phone, sending when you have signal)</span>}
              <Flags flags={clockedIn.flags} />
            </li>
          )}
          {clockedOut && (
            <li>
              Clocked out {timeLabel(clockedOut.at, undefined, clock.timeZone)}
              {pendingOut && <span className="text-sm text-[#9A7049]"> (saved on your phone, sending when you have signal)</span>}
              <Flags flags={clockedOut.flags} />
            </li>
          )}
        </ul>
      )}

      {!clockedIn &&
        (open ? (
          <button type="button" onClick={() => punch("in")} disabled={busy} className="w-full rounded-xl bg-[#2C2420] text-white py-3 font-medium disabled:opacity-40">
            {busy ? "Clocking in..." : "Clock in"}
          </button>
        ) : (
          <p className="text-[15px] text-[#6B5D52]">Clock in opens at {timeLabel(clock.opensAt, undefined, clock.timeZone)}.</p>
        ))}

      {clockedIn &&
        !clockedOut &&
        (confirmOut ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] text-[#2C2420]">Clock out now?</span>
            <button type="button" onClick={() => punch("out")} disabled={busy} className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
              {busy ? "Clocking out..." : "Yes, clock out"}
            </button>
            <button type="button" onClick={() => setConfirmOut(false)} disabled={busy} className="text-sm text-[#6B5D52] underline">
              Not yet
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmOut(true)} disabled={busy} className="w-full rounded-xl border-2 border-[#2C2420] text-[#2C2420] py-3 font-medium disabled:opacity-40">
            Clock out
          </button>
        ))}

      {clockedOut && wrapUp && (
        <div className="rounded-xl bg-[#FFF8EC] border border-[#E3C9A0] px-3 py-2.5 space-y-2">
          <p className="text-[15px] text-[#2C2420]">You clocked out. Please do your wrap up before you go.</p>
          <button type="button" onClick={wrapUp} className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium">
            Do the wrap up
          </button>
        </div>
      )}

      {!clockedOut && <p className="text-xs text-[#A39585]">Your location is saved with each punch. No signal? Tap anyway, it sends later.</p>}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}
