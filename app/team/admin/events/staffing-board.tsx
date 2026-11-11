"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ListSection } from "@/lib/team/event-list";
import { shownEvents, type CalGrid, type CalLinks } from "@/lib/team/calendar";
import { selectedMessage } from "@/lib/team/select-message";
import EventList from "../../events/event-list";
import CalendarView from "../../calendar-view";

/**
 * The upcoming staffing list or calendar, with a "Select" mode: tick the
 * events to post, then "Post <n> shifts". Events that cannot be posted show a
 * short reason instead of a checkbox (`reasons`, worked out on the server and
 * checked again when posting).
 */
export default function StaffingBoard({
  calendar,
  sections,
  grid,
  links,
  empty,
  reasons,
}: {
  calendar: boolean;
  sections: ListSection[];
  grid: CalGrid | null;
  links: CalLinks | null;
  empty: string;
  reasons: Record<string, string>;
}) {
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAll = (ids: string[]) => setSelected((cur) => new Set([...cur, ...ids]));
  const stop = () => {
    setSelecting(false);
    setSelected(new Set());
    setError("");
  };

  const post = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/admin/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "post_selected", sessionIds: [...selected] }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not post.");
      setMessage(selectedMessage(d));
      stop();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post.");
    } finally {
      setBusy(false);
    }
  };

  const select = selecting ? { selected, reasons, toggle, selectAll } : undefined;
  const calIds = grid ? shownEvents(grid).filter((e) => !reasons[e.id]).map((e) => e.id) : [];

  return (
    <div className={`space-y-3 ${selecting ? "pb-24" : ""}`}>
      <div className="flex flex-wrap items-center gap-3 px-1">
        {selecting ? (
          <>
            <span className="text-sm text-[#2C2420]">Tick the events to post to their markets.</span>
            {calendar && (
              <button type="button" onClick={() => selectAll(calIds)} disabled={calIds.length === 0} className="text-sm text-[#9A7049] underline disabled:opacity-40">
                Select all shown ({calIds.length})
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setSelecting(true);
              setMessage("");
            }}
            className="rounded-xl border border-[#DDD5CC] bg-[#F5F0EB] text-[#2C2420] px-4 py-2 text-sm font-medium"
          >
            Select
          </button>
        )}
      </div>
      {message && <p className="px-1 text-sm text-[#55684A]">{message}</p>}

      {calendar && grid && links ? (
        <CalendarView grid={grid} links={links} empty={empty} select={select} />
      ) : (
        <EventList sections={sections} empty={empty} select={select} />
      )}

      {selecting && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#DDD5CC] bg-[#F5F0EB]/95 backdrop-blur px-4 py-3">
          <div className="max-w-2xl mx-auto flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={post}
              disabled={busy || selected.size === 0}
              className="rounded-xl bg-[#B5845A] text-white px-5 py-2.5 text-sm font-medium disabled:opacity-40"
            >
              {busy ? "Posting..." : `Post ${selected.size} ${selected.size === 1 ? "shift" : "shifts"}`}
            </button>
            <button type="button" onClick={stop} disabled={busy} className="text-sm text-[#6B5D52] underline">
              Cancel
            </button>
            {error && <span className="text-sm text-[#A0412D]">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
