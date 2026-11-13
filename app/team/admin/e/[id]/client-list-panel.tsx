"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { timeLabel } from "@/lib/team/clock-label";

export interface PanelHold {
  id: string;
  kind: "change" | "custom_recipe";
  createdAt: string;
  summary: string;
  blocks: string[]; // every change, before and after in full
  listChanges: string;
  price: string;
  priceAmount: number | null;
}

export interface PanelLog {
  id: string;
  at: string;
  action: string;
  reason: string;
  detail: string;
  changes: string;
  by: string;
  dryRun: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  sent: "Sent",
  held: "Held",
  approved: "Approved",
  declined: "Declined",
  not_sent: "Not sent",
};

/** The Client list tab: change requests waiting on an admin, the client's list now, and every send and hold. */
export default function ClientListPanel({
  sessionId,
  autoSend,
  holds,
  log,
  listText,
  timeZone,
}: {
  sessionId: string;
  autoSend: boolean;
  holds: PanelHold[];
  log: PanelLog[];
  listText: string;
  timeZone: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showList, setShowList] = useState(false);

  const act = async (action: "approve" | "decline" | "review", holdId: string) => {
    setBusy(`${action}:${holdId}`);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/team/admin/client-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sessionId, holdId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setMessage(d.message ?? "Done.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Client shopping list</h2>
        <span className={`text-xs rounded-full px-2 py-0.5 ${autoSend ? "bg-[#E4EBDF] text-[#55684A]" : "bg-[#E8DDD5] text-[#6B5D52]"}`}>
          Auto send {autoSend ? "on" : "off (dry run, nothing goes to the client)"}
        </span>
      </div>

      {holds.map((h) => (
        <div key={h.id} className="rounded-xl border border-[#E3C9A0] bg-[#FFF8EC] px-3 py-3 space-y-2">
          {h.kind === "change" ? (
            <>
              <p className="text-[15px] font-medium text-[#2C2420]">Client change request</p>
              <p className="text-sm text-[#6B5D52]">Asked {timeLabel(h.createdAt, undefined, timeZone)}, inside 6 days of the event. Not saved until you approve it.</p>
              <div className="space-y-2">
                {(h.blocks.length > 0 ? h.blocks : [h.summary]).map((b, i) => (
                  <p key={i} className="text-sm text-[#2C2420] whitespace-pre-line rounded-lg bg-white border border-[#EDE6DF] px-2.5 py-1.5">
                    {b}
                  </p>
                ))}
              </div>
              <p className="text-sm text-[#6B5D52]">
                {h.price ? `Price difference: ${h.price}` : h.priceAmount === 0 ? "Price difference: none." : "No price difference."}
              </p>
              {h.listChanges && <p className="text-sm text-[#6B5D52] whitespace-pre-line">Client list changes:{"\n"}{h.listChanges}</p>}
              <div className="flex gap-2">
                <button type="button" disabled={!!busy} onClick={() => act("approve", h.id)} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
                  {busy === `approve:${h.id}` ? "Approving..." : "Approve"}
                </button>
                <button type="button" disabled={!!busy} onClick={() => act("decline", h.id)} className="rounded-lg border-2 border-[#B5845A] text-[#9A7049] px-4 py-2 text-sm font-medium disabled:opacity-40">
                  {busy === `decline:${h.id}` ? "Declining..." : "Decline"}
                </button>
              </div>
              <p className="text-xs text-[#A39585]">Approve saves it like any update: the lists, the bartenders&apos; supplies list and staff texts follow, and GHL is told so it can text the client. Decline changes nothing and GHL is told.</p>
            </>
          ) : (
            <>
              <p className="text-[15px] font-medium text-[#2C2420]">First list held: a drink has a custom recipe</p>
              <p className="text-sm text-[#6B5D52]">Check the recipe and the list, then send it.</p>
              <button type="button" disabled={!!busy} onClick={() => act("review", h.id)} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
                {busy === `review:${h.id}` ? "Sending..." : "Review and send"}
              </button>
            </>
          )}
        </div>
      ))}

      {message && <p className="rounded-xl bg-[#E4EBDF] text-[#55684A] px-3 py-2 text-sm">{message}</p>}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}

      <button type="button" onClick={() => setShowList((o) => !o)} className="text-sm text-[#B5845A] underline">
        {showList ? "Hide the client's list" : "Show the client's list as it stands"}
      </button>
      {showList && <pre className="whitespace-pre-wrap break-words font-sans text-sm text-[#2C2420] bg-white rounded-xl border border-[#DDD5CC] px-3 py-2">{listText || "Nothing for the client to buy on this package."}</pre>}

      <div>
        <h3 className="text-xs text-[#A39585] uppercase tracking-wide mb-1">Sends and holds</h3>
        {log.length === 0 ? (
          <p className="text-sm text-[#6B5D52]">Nothing yet.</p>
        ) : (
          <ul className="space-y-2">
            {log.map((l) => (
              <li key={l.id} className="text-sm border-t border-[#EDE6DF] pt-2 first:border-0 first:pt-0">
                <p className="text-[#2C2420]">
                  <span className="font-medium">{ACTION_LABEL[l.action] ?? l.action}</span>
                  {l.reason ? ` (${l.reason})` : ""} · {timeLabel(l.at, undefined, timeZone)}
                  {l.by ? ` · ${l.by}` : ""}
                  {l.dryRun ? " · dry run" : ""}
                </p>
                <p className="text-[#6B5D52]">{l.detail}</p>
                {l.changes && <p className="text-[#6B5D52] whitespace-pre-line">{l.changes}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
