"use client";

// The client's own questions on their event page, written to them: finish the
// drink menu (opens the chat on the drinks step), and the extra drink they
// named past their package count (Yes adds it for $50, No drops it). The
// team's notes about the same things never reach this page.

import { useState } from "react";
import { DRINKS_UNFINISHED_LINE, FINISH_DRINKS_BUTTON, extraDrinkQuestion, type ClientAsks as Asks } from "@/lib/team-notes";

export interface ExtraDrinkReply {
  kind: "added" | "requested" | "declined";
  eventData: Record<string, unknown>;
  asks: Asks;
  version: number;
  updatedAt: string | null;
  pending: boolean;
}

export default function ClientAsks({
  sessionId,
  asks,
  onFinishDrinks,
  onAnswered,
  disabled = false,
}: {
  sessionId: string;
  asks: Asks | null;
  onFinishDrinks: () => void;
  onAnswered: (reply: ExtraDrinkReply) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  if (!asks) return null;
  const question = extraDrinkQuestion(asks);
  if (!asks.drinksUnfinished && !question && !done) return null;

  const answer = async (accept: boolean) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/client-extra-drink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, accept }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save. Try again.");
        return;
      }
      const reply = data as ExtraDrinkReply;
      setDone(
        reply.kind === "declined"
          ? "Got it. We left it off your menu."
          : reply.kind === "requested"
            ? "Got it. Your event is less than a week away, so our team will confirm it with you."
            : "Added to your menu."
      );
      onAnswered(reply);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const button = "rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40";
  return (
    <div className="py-2.5 border-b border-[#DDD5CC] last:border-0 space-y-3" data-client-asks>
      {asks.drinksUnfinished && (
        <div className="rounded-xl border border-[#E3C9A0] bg-[#FFF8EC] px-3 py-2.5 space-y-2">
          <p className="text-[15px] text-[#2C2420]">{DRINKS_UNFINISHED_LINE}</p>
          <button type="button" onClick={onFinishDrinks} disabled={disabled} className={`${button} bg-[#B5845A] text-white`}>
            {FINISH_DRINKS_BUTTON}
          </button>
        </div>
      )}
      {question && (
        <div className="rounded-xl border border-[#E3C9A0] bg-[#FFF8EC] px-3 py-2.5 space-y-2">
          <p className="text-[15px] text-[#2C2420]">{question}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => answer(true)} disabled={busy || disabled} className={`${button} bg-[#B5845A] text-white`}>
              Yes
            </button>
            <button type="button" onClick={() => answer(false)} disabled={busy || disabled} className={`${button} border border-[#2C2420] text-[#2C2420]`}>
              No
            </button>
          </div>
        </div>
      )}
      {done && <p className="text-sm text-[#2C2420]">{done}</p>}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </div>
  );
}
