"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StaffEventView } from "@/lib/team/event-view";
import { CHECKLIST_INTRO, CHECKLIST_TITLE, CONFIRM_LABEL, type ResolvedGroup } from "@/lib/team/checklist-config";
import type { ShopItem, ShoppingGroup } from "@/lib/team/shopping";
import type { SyrupView } from "@/lib/syrups";
import { SyrupCard } from "../../syrup-recipes";
import { SUPPLIES_INTRO, SUPPLIES_TAB, SUPPLIES_TITLE, UPDATED_TITLE } from "@/lib/team/supplies";
import { WRAP_UP_TAB } from "@/lib/team/wrapup";
import { prepSteps, SUPPLIES_CONFIRM_LABEL, TOOLS_TAB } from "@/lib/team/prep";
import { canConfirm, type CheckState, type ListName } from "@/lib/team/checks";
import { timeLabel } from "@/lib/team/clock-label";
import BarReadyCard, { type BarReadyProps } from "./bar-ready";
import CloseoutCard, { type CloseoutProps } from "./closeout-card";
import RespondBanner from "./respond-banner";
import ClockCard from "./clock-card";
import GiveUp, { type GiveUpProps } from "./give-up";
import type { ClockView } from "@/lib/team/clock-db";
import ChatThread, { type ChatProps } from "./chat-thread";
import { useLiveUnread, useOpenChat } from "../../chat-focus";
import MyPickupCard from "../../menu-pickup-card";
import IcePickupCard from "../../ice-pickup-card";
import type { IceView } from "@/lib/team/ice-pickup-db";
import type { MyPickup } from "@/lib/team/menu-pickup-db";
import type { StaffMenuSection } from "@/lib/team/approved-menu-db";
import MenuSection from "./menu-section";
import { card, Details } from "./event-details";
import VenuePhotos from "./venue-photos";
import ShoppingList from "./shopping-list";
import { LIST_MOVED, LIST_MOVED_BUTTON, LIST_TAB, type StaffListView } from "@/lib/team/staff-list";
import type { VenuePhotoView } from "@/lib/team/venue-photos-db";
import PackageCard from "../../package-card";
import type { BookingShort } from "@/lib/packages-info";
import PayEstimateCard from "../../pay-estimate-card";
import { money, type StaffEstimate } from "@/lib/team/pay";
import RunningLowButton from "../../running-low";
import Receipts from "./receipts";
import type { StaffReceiptsView } from "@/lib/team/receipts-db";
import { RECEIPTS_TAB } from "@/lib/team/receipts";

export { Details };


export type Tab = "details" | "checklist" | "shopping" | "list" | "wrapup" | "receipts" | "chat";

function Progress({ state }: { state: Record<string, CheckState> }) {
  const values = Object.values(state);
  const checked = values.filter((s) => s.checked).length;
  const total = values.length;
  return (
    <div className="sticky top-0 z-10 bg-[#E8DDD5] pt-1 pb-2">
      <div className="flex items-center justify-between text-sm text-[#2C2420] mb-1">
        <span className="font-medium">
          {checked} of {total} checked
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[#DDD5CC] overflow-hidden">
        <div className="h-full bg-[#8B9E7E] transition-all" style={{ width: `${total ? (checked / total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

function CheckLine({
  label,
  detail,
  state,
  onToggle,
}: {
  label: string;
  detail?: string;
  state: CheckState;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-3 py-2.5 text-left border-b border-[#DDD5CC] last:border-0"
        aria-pressed={state.checked}
      >
        <span
          className={`mt-0.5 w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 ${
            state.checked ? "bg-[#8B9E7E] border-[#8B9E7E] text-white" : "border-[#A39585] bg-white"
          }`}
        >
          {state.checked && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5L20 7" />
            </svg>
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span className={`text-[15px] ${state.checked ? "text-[#6B5D52] line-through" : "text-[#2C2420]"}`}>{label}</span>
          {state.changed && (
            <span className="ml-2 align-middle text-[11px] font-bold uppercase tracking-wide text-[#A0412D] bg-[#F6E3DC] px-1.5 py-0.5 rounded">
              changed
            </span>
          )}
          {detail && <span className="block text-sm text-[#6B5D52]">{detail}</span>}
        </span>
      </button>
    </li>
  );
}

function useChecks(
  sessionId: string,
  list: ListName,
  initial: Record<string, CheckState>,
  onToggle?: (checked: boolean) => void
) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState("");
  const toggle = async (key: string) => {
    const before = state[key];
    if (!before) return;
    const next = { checked: !before.checked, changed: false };
    setState((s) => ({ ...s, [key]: next }));
    onToggle?.(next.checked);
    setError("");
    try {
      const res = await fetch("/api/team/checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, list, key, checked: next.checked }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not save.");
    } catch (err) {
      setState((s) => ({ ...s, [key]: before }));
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  };
  return { state, toggle, error };
}

function Checklist({
  sessionId,
  groups,
  initial,
  footer,
  initialConfirmedAt,
  timeZone,
  onConfirmed,
}: {
  sessionId: string;
  groups: ResolvedGroup[];
  initial: Record<string, CheckState>;
  footer: string;
  initialConfirmedAt: string | null;
  timeZone: string;
  onConfirmed: (at: string | null) => void; // step 1 done or undone, for the strip
}) {
  const [confirmedAt, setConfirmedAtState] = useState(initialConfirmedAt);
  const setConfirmedAt = (at: string | null) => {
    setConfirmedAtState(at);
    onConfirmed(at);
  };
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  // Unchecking any item clears the confirmation (the server clears it too).
  const { state, toggle, error } = useChecks(sessionId, "checklist", initial, (checked) => {
    if (!checked) setConfirmedAt(null);
  });
  const ready = canConfirm(state);

  const confirm = async () => {
    setConfirming(true);
    setConfirmError("");
    try {
      const res = await fetch("/api/team/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      setConfirmedAt(data.confirmedAt);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="px-1">
        <h2 className="font-heading text-xl font-bold text-[#2C2420]">{CHECKLIST_TITLE}</h2>
        <p className="text-[15px] text-[#6B5D52]">{CHECKLIST_INTRO}</p>
      </div>
      <Progress state={state} />
      {error && <p className="text-sm text-[#A0412D] px-1">{error}</p>}
      {groups.map((g) => (
        <section key={g.id} className={card}>
          <h3 className="font-heading text-base font-bold text-[#2C2420]">{g.title}</h3>
          <p className="text-sm text-[#6B5D52] mb-2">{g.subtitle}</p>
          {g.sections.map((s) => (
            <div key={s.title} className="mt-2">
              <h4 className="text-xs text-[#A39585] uppercase tracking-wide">{s.title}</h4>
              <ul>
                {s.lines.map((l) =>
                  l.info ? (
                    <li key={l.key} className="flex items-start gap-3 py-2.5 border-b border-[#DDD5CC] last:border-0">
                      <span className="mt-0.5 w-6 h-6 rounded-full bg-[#E8DDD5] text-[#B5845A] text-sm font-bold flex items-center justify-center shrink-0">
                        i
                      </span>
                      <span className="text-[15px] text-[#2C2420]">{l.label}</span>
                    </li>
                  ) : (
                    <CheckLine key={l.key} label={l.label} state={state[l.key] ?? { checked: false, changed: false }} onToggle={() => toggle(l.key)} />
                  )
                )}
              </ul>
            </div>
          ))}
        </section>
      ))}
      <p className="text-sm text-[#6B5D52] px-1">{footer}</p>
      {confirmedAt && ready ? (
        <p className="w-full rounded-xl bg-[#8B9E7E] text-white py-3 text-center font-medium">Confirmed {timeLabel(confirmedAt, undefined, timeZone)}</p>
      ) : (
        <button
          type="button"
          onClick={confirm}
          disabled={!ready || confirming}
          className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40 hover:bg-[#9A7049] transition-colors"
        >
          {confirming ? "Saving..." : CONFIRM_LABEL}
        </button>
      )}
      {!ready && <p className="text-xs text-[#A39585] text-center">The button turns on when every item is checked.</p>}
      {confirmError && <p className="text-sm text-[#A0412D] text-center">{confirmError}</p>}
    </div>
  );
}

function itemDetail(i: ShopItem): string {
  return [i.quantity, i.brand].filter(Boolean).join(", ");
}

function MissingSheet({ sessionId, items, onClose }: { sessionId: string; items: ShopItem[]; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const send = async () => {
    setStatus("sending");
    setError("");
    try {
      const res = await fetch("/api/team/missing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, keys: picked, note }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not send.");
      setStatus("sent");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Could not send.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="w-full sm:max-w-md max-h-[85dvh] flex flex-col bg-[#F5F0EB] rounded-t-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[#DDD5CC] flex items-center justify-between">
          <h3 className="font-heading text-base font-bold text-[#2C2420]">Something is missing</h3>
          <button type="button" onClick={onClose} className="text-sm text-[#6B5D52]">
            Close
          </button>
        </div>
        {status === "sent" ? (
          <div className="px-4 py-6 text-center space-y-3">
            <p className="text-[15px] text-[#2C2420]">Sent to the team. Someone will text you back.</p>
            <button type="button" onClick={onClose} className="rounded-xl bg-[#B5845A] text-white px-6 py-2.5 font-medium">
              Done
            </button>
          </div>
        ) : (
          <>
            <ul className="flex-1 overflow-y-auto px-4">
              {items.map((i) => (
                <CheckLine
                  key={i.key}
                  label={i.item}
                  detail={itemDetail(i)}
                  state={{ checked: picked.includes(i.key), changed: false }}
                  onToggle={() => setPicked((p) => (p.includes(i.key) ? p.filter((k) => k !== i.key) : [...p, i.key]))}
                />
              ))}
            </ul>
            <div className="px-4 py-3 border-t border-[#DDD5CC] space-y-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note (optional)"
                rows={2}
                className="w-full resize-none rounded-xl border border-[#DDD5CC] bg-[#E8DDD5] px-3.5 py-2.5 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30"
              />
              {error && <p className="text-sm text-[#A0412D]">{error}</p>}
              <button
                type="button"
                onClick={send}
                disabled={status === "sending" || (picked.length === 0 && !note.trim())}
                className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40"
              >
                {status === "sending" ? "Sending..." : `Text the team${picked.length ? ` (${picked.length})` : ""}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export interface ShoppingLayout {
  banner: string | null;
  groups: ShoppingGroup[];
}

/** "Updated": what changed on the list since this person last looked, until they tap Got it. */
function UpdatedNote({ sessionId, changes }: { sessionId: string; changes: string[] }) {
  const [open, setOpen] = useState(changes.length > 0);
  if (!open) return null;
  const gotIt = async () => {
    setOpen(false);
    await fetch("/api/team/supplies-seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) }).catch(() => {});
  };
  return (
    <section className="bg-[#FFF8EC] rounded-2xl border border-[#E3C9A0] px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-heading text-sm font-bold uppercase tracking-wide text-[#8A4B12]">{UPDATED_TITLE}</h3>
        <button type="button" onClick={gotIt} className="text-sm text-[#9A7049] underline py-1">
          Got it
        </button>
      </div>
      <ul className="mt-1 space-y-0.5">
        {changes.map((c, i) => (
          <li key={i} className="text-[15px] text-[#2C2420] break-words">
            {c}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Top of Supplies, for people who see the Shopping list tab: older texts link here. */
function ListMovedCard({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="bg-[#FFF8EC] rounded-2xl border border-[#E3C9A0] px-4 py-3 flex flex-wrap items-center justify-between gap-2" aria-label="Shopping list moved" data-list-moved>
      <p className="text-[15px] text-[#2C2420]">{LIST_MOVED}</p>
      <button type="button" onClick={onOpen} className="rounded-xl bg-[#B5845A] text-white px-4 py-2 text-sm font-medium">
        {LIST_MOVED_BUTTON}
      </button>
    </section>
  );
}

/** "1 Tools, 2 Supplies", each Done or To do. Tapping a step opens its tab. */
function PrepStrip({ tools, supplies, onOpen }: { tools: boolean; supplies: boolean; onOpen: (tab: Tab) => void }) {
  return (
    <ol className="grid grid-cols-2 gap-2" aria-label="Before the event">
      {prepSteps({ tools, supplies }).map((s) => (
        <li key={s.n}>
          <button
            type="button"
            onClick={() => onOpen(s.n === 1 ? "checklist" : "shopping")}
            className={`w-full rounded-xl border px-3 py-2 text-left ${s.done ? "border-[#8B9E7E] bg-[#EEF2EA]" : "border-[#E3C9A0] bg-[#FFF8EC]"}`}
          >
            <span className="block text-[15px] font-medium text-[#2C2420]">
              {s.n} {s.label}
            </span>
            <span className={`block text-sm ${s.done ? "text-[#55684A]" : "text-[#8A4B12]"}`}>{s.done ? "Done" : "To do"}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function Supplies({
  sessionId,
  shopping,
  initial,
  updates,
  syrups,
  confirmedAt,
  onConfirmed,
  timeZone,
}: {
  sessionId: string;
  shopping: ShoppingLayout;
  initial: Record<string, CheckState>;
  updates: string[];
  syrups: SyrupView[];
  confirmedAt: string | null;
  onConfirmed: (at: string) => void;
  timeZone: string;
}) {
  const { state, toggle, error } = useChecks(sessionId, "shopping", initial);
  const [missingOpen, setMissingOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [reported, setReported] = useState<string[]>([]);
  const all = shopping.groups.flatMap((g) => g.items);
  const unchecked = all.filter((i) => !state[i.key]?.checked);

  const confirm = async () => {
    setSaving(true);
    setConfirmError("");
    try {
      const res = await fetch("/api/team/supplies-confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      setReported(data.missing ?? []);
      setAsking(false);
      onConfirmed(data.confirmedAt);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <UpdatedNote sessionId={sessionId} changes={updates} />
      <div className="px-1">
        <h2 className="font-heading text-xl font-bold text-[#2C2420]">{SUPPLIES_TITLE}</h2>
        <p className="text-[15px] text-[#6B5D52]">{SUPPLIES_INTRO}</p>
      </div>
      {shopping.banner && (
        <p className="bg-[#FFF8EC] rounded-2xl border border-[#E3C9A0] px-4 py-3 text-[15px] font-medium text-[#2C2420]">{shopping.banner}</p>
      )}
      <Progress state={state} />
      {error && <p className="text-sm text-[#A0412D] px-1">{error}</p>}
      {shopping.groups.map(({ id, title, note, items }) => (
        <section key={id} className={card}>
          <h3 className="font-heading text-base font-bold text-[#2C2420] mb-1">{title}</h3>
          {note && <p className="text-sm text-[#6B5D52] mb-1">{note}</p>}
          {items.length === 0 ? (
            <p className="text-sm text-[#6B5D52] py-2">Nothing on this list for this package.</p>
          ) : (
            <ul>
              {items.map((i) => (
                <CheckLine key={i.key} label={i.item} detail={itemDetail(i)} state={state[i.key] ?? { checked: false, changed: false }} onToggle={() => toggle(i.key)} />
              ))}
            </ul>
          )}
        </section>
      ))}
      <SyrupCard syrups={syrups} />
      <button
        type="button"
        onClick={() => setMissingOpen(true)}
        className="w-full rounded-xl border-2 border-[#B5845A] text-[#B5845A] py-3 font-medium hover:bg-[#F5F0EB]"
      >
        Something is missing
      </button>
      {confirmedAt ? (
        <div className="space-y-1">
          <p className="w-full rounded-xl bg-[#8B9E7E] text-white py-3 text-center font-medium">Went through the supplies list {timeLabel(confirmedAt, undefined, timeZone)}</p>
          {reported.length > 0 && <p className="text-sm text-[#6B5D52] text-center">Reported missing to the team: {reported.join(", ")}</p>}
        </div>
      ) : asking && unchecked.length > 0 ? (
        <div className="rounded-2xl border border-[#E3C9A0] bg-[#FFF8EC] px-4 py-3 space-y-2" role="alertdialog" aria-label="Unchecked supplies">
          <p className="text-[15px] text-[#2C2420]">
            {unchecked.length === 1 ? "1 item is" : `${unchecked.length} items are`} not checked off. They will be reported missing to the team:
          </p>
          <p className="text-sm text-[#6B5D52] break-words">{unchecked.map((i) => i.item).join(", ")}</p>
          <div className="flex gap-2">
            <button type="button" onClick={confirm} disabled={saving} className="flex-1 rounded-xl bg-[#B5845A] text-white py-2.5 font-medium disabled:opacity-40">
              {saving ? "Saving..." : "Report them and confirm"}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="rounded-xl border border-[#DDD5CC] px-4 py-2.5 text-[#6B5D52]">
              Keep checking
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => (unchecked.length > 0 ? setAsking(true) : confirm())}
          disabled={saving}
          className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40 hover:bg-[#9A7049] transition-colors"
        >
          {saving ? "Saving..." : SUPPLIES_CONFIRM_LABEL}
        </button>
      )}
      {confirmError && <p className="text-sm text-[#A0412D] text-center">{confirmError}</p>}
      {missingOpen && <MissingSheet sessionId={sessionId} items={all} onClose={() => setMissingOpen(false)} />}
    </div>
  );
}

export default function EventTabs({
  view,
  checklist,
  checklistState,
  checklistFooter,
  confirmedAt,
  suppliesConfirmedAt = null,
  shopping,
  shoppingState,
  supplyUpdates = [],
  syrups = [],
  barReady,
  photoReminder = null,
  closeout = null,
  wrapUpDone = false,
  pay = null,
  offered,
  managerHref,
  clock,
  renderedAt,
  giveUp,
  chat,
  initialTab = "details",
  menuPickup = null,
  menuSection = null,
  ice = null,
  runningLow = null,
  venuePhotos = null,
  receipts = null,
  packageBooking = null,
  shoppingList = null,
}: {
  packageBooking?: BookingShort | null; // this booking's barback and cups, for the Package card
  shoppingList?: StaffListView | null; // the Shopping list tab: accepted staff and admins in Bartender view only
  receipts?: StaffReceiptsView | null; // the Receipts tab: on the event, not declined, until 14 days after it
  venuePhotos?: VenuePhotoView | null; // Bar and venue photos on the Location card, read only, for staff on the event
  runningLow?: { items: string[] } | null; // the Running low button, from setup through the end of breakdown
  ice?: IceView | null; // the ice pickup card on the Details tab, for people on the event
  menuSection?: StaffMenuSection | null; // the menu on the Details tab, for staff on the event
  chat: ChatProps;
  menuPickup?: MyPickup | null; // "Pick up the menu", when this person is picking it up
  initialTab?: Tab;
  giveUp: GiveUpProps | null;
  offered: boolean;
  clock: ClockView;
  renderedAt: number;
  managerHref: string | null; // an admin looking at the bartender view of this event: the way back
  view: StaffEventView;
  checklist: ResolvedGroup[];
  checklistState: Record<string, CheckState>;
  checklistFooter: string;
  confirmedAt: string | null;
  suppliesConfirmedAt?: string | null;
  shopping: ShoppingLayout;
  shoppingState: Record<string, CheckState>;
  supplyUpdates?: string[]; // the Updated note on the Supplies tab
  syrups?: SyrupView[]; // Syrup recipes, after the drinks on the Supplies tab
  barReady: Omit<BarReadyProps, "sessionId"> & { show: boolean };
  photoReminder?: string | null; // no bar setup photo yet after service started
  closeout?: Omit<CloseoutProps, "sessionId"> | null; // the Wrap up tab, once bar service has started
  wrapUpDone?: boolean;
  pay?: StaffEstimate | null; // the viewer's own estimate: hourly, mileage, tips
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const chatUnread = useLiveUnread(chat.sessionId, initialTab === "chat" ? 0 : chat.unread, tab === "chat");
  useOpenChat(chat.sessionId, useCallback(() => setTab("chat"), []));
  const [wrapped, setWrapped] = useState(wrapUpDone);
  // 1 Tools, 2 Supplies. Neither locks a tab or blocks clock in: every tab opens any time.
  const [toolsAt, setToolsAt] = useState(confirmedAt);
  const [suppliesAt, setSuppliesAt] = useState(suppliesConfirmedAt);
  const tabs: [Tab, string][] = [
    ["details", "Details"],
    ["checklist", TOOLS_TAB],
    ["shopping", SUPPLIES_TAB],
    ...(shoppingList ? ([["list", LIST_TAB]] as [Tab, string][]) : []),
    ...(closeout ? ([["wrapup", WRAP_UP_TAB]] as [Tab, string][]) : []),
    ...(receipts ? ([["receipts", RECEIPTS_TAB]] as [Tab, string][]) : []),
    ["chat", `Chat${chatUnread ? ` (${chatUnread})` : ""}`],
  ];
  // One row that swipes sideways on a phone. Opened from a link (?tab=list),
  // the selected tab scrolls into view so it shows highlighted without swiping.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!nav || !el) return;
    const left = el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: "auto" });
  }, [tab]);

  return (
    <main className="max-w-2xl mx-auto px-4 py-4 sm:py-6 space-y-4">
      <div className="px-1">
        {/* "Justin · Birthday"; the client's own event name is a smaller second line, never the title. */}
        <h1 className="font-heading text-2xl font-bold text-[#2C2420] break-words">{[view.clientFirstName, view.eventType].filter(Boolean).join(" · ") || view.eventName || "Event"}</h1>
        {view.eventName && (view.clientFirstName || view.eventType) && <p className="text-[17px] text-[#2C2420] break-words">{view.eventName}</p>}
        <p className="text-[15px] text-[#6B5D52]">
          {[view.date, view.arrival ? `arrive ${view.arrival}` : ""].filter(Boolean).join(", ")}
        </p>
        {pay && (
          <p className="text-sm text-[#55684A]">
            <span className="font-semibold">{money(pay.totalCents)}</span> estimated pay, before taxes. See the Details tab.
          </p>
        )}
        {managerHref && (
          <a href={managerHref} className="inline-block mt-1 text-sm text-[#B5845A] underline">
            Back to manager view
          </a>
        )}
      </div>

      {offered && <RespondBanner sessionId={view.sessionId} />}

      {menuPickup && <MyPickupCard pickup={menuPickup} showEvent={false} />}

      {giveUp?.handoff && <GiveUp {...giveUp} />}

      {clock.canPunch && (
        <ClockCard sessionId={view.sessionId} initial={clock} renderedAt={renderedAt} wrapUp={closeout && !wrapped ? () => setTab("wrapup") : undefined} />
      )}

      <PrepStrip tools={!!toolsAt} supplies={!!suppliesAt} onOpen={setTab} />

      {runningLow && <RunningLowButton sessionId={view.sessionId} items={runningLow.items} />}

      {photoReminder && tab !== "checklist" && (
        <section className="bg-[#FFF8EC] rounded-2xl border border-[#E3C9A0] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[15px] text-[#2C2420]">{photoReminder}</p>
          <button type="button" onClick={() => setTab("checklist")} className="text-sm font-medium text-[#9A7049] underline">
            Add the photo
          </button>
        </section>
      )}

      <nav ref={navRef} className="flex flex-nowrap gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-[#DDD5CC] p-1 rounded-xl" role="tablist">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
            }}
            className={`flex-1 shrink-0 whitespace-nowrap py-2 px-3 rounded-lg text-[13px] sm:text-sm font-medium leading-tight transition-colors ${
              tab === key ? "bg-[#F5F0EB] text-[#2C2420] shadow-sm" : "text-[#6B5D52]"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div hidden={tab !== "details"} className="space-y-4">
        {ice && <IcePickupCard initial={ice} />}
        {menuSection && <MenuSection menu={menuSection} />}
        <Details v={view} locationExtra={venuePhotos ? <VenuePhotos sessionId={view.sessionId} initial={venuePhotos} timeZone={view.timeZone} /> : null} />
        {pay && <PayEstimateCard estimate={pay} />}
        <PackageCard packageName={view.package} booking={packageBooking ?? undefined} />
        {giveUp && !giveUp.handoff && giveUp.canStart && (
          <div className="mt-4">
            <GiveUp {...giveUp} />
          </div>
        )}
      </div>
      <div hidden={tab !== "checklist"} className="space-y-4">
        {barReady.show && <BarReadyCard sessionId={view.sessionId} {...barReady} reminder={photoReminder ?? undefined} />}
        <Checklist
          sessionId={view.sessionId}
          groups={checklist}
          initial={checklistState}
          footer={checklistFooter}
          initialConfirmedAt={confirmedAt}
          timeZone={view.timeZone}
          onConfirmed={setToolsAt}
        />
      </div>
      <div hidden={tab !== "shopping"} className="space-y-4">
        {shoppingList && <ListMovedCard onOpen={() => setTab("list")} />}
        <Supplies
          sessionId={view.sessionId}
          shopping={shopping}
          initial={shoppingState}
          updates={supplyUpdates}
          syrups={syrups}
          confirmedAt={suppliesAt}
          onConfirmed={setSuppliesAt}
          timeZone={view.timeZone}
        />
      </div>
      {shoppingList && (
        <div hidden={tab !== "list"}>
          <ShoppingList initial={shoppingList} />
        </div>
      )}
      {closeout && (
        <div hidden={tab !== "wrapup"}>
          <CloseoutCard sessionId={view.sessionId} {...closeout} onSent={() => setWrapped(true)} />
        </div>
      )}
      {receipts && (
        <div hidden={tab !== "receipts"}>
          <Receipts sessionId={view.sessionId} mode="staff" initial={receipts.receipts} ready={receipts.ready} openUntil={receipts.openUntil} timeZone={view.timeZone} preview={receipts.preview} />
        </div>
      )}
      <div hidden={tab !== "chat"}>
        <ChatThread {...chat} active={tab === "chat"} />
      </div>
    </main>
  );
}
