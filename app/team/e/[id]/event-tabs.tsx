"use client";

import { useCallback, useState } from "react";
import type { StaffEventView } from "@/lib/team/event-view";
import { CHECKLIST_INTRO, CHECKLIST_TITLE, CONFIRM_LABEL, type ResolvedGroup } from "@/lib/team/checklist-config";
import type { ShopItem, ShoppingGroup } from "@/lib/team/shopping";
import { SUPPLIES_INTRO, SUPPLIES_TAB, SUPPLIES_TITLE, UPDATED_TITLE } from "@/lib/team/supplies";
import { WRAP_UP_TAB } from "@/lib/team/wrapup";
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
import type { MyPickup } from "@/lib/team/menu-pickup-db";
import type { StaffMenuSection } from "@/lib/team/approved-menu-db";
import MenuSection from "./menu-section";


export type Tab = "details" | "checklist" | "shopping" | "wrapup" | "chat";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";

function Row({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  if (!value && !children) return null;
  return (
    <div className="py-2.5 border-b border-[#DDD5CC] last:border-0">
      <dt className="text-xs text-[#A39585] uppercase tracking-wide mb-0.5">{label}</dt>
      <dd className="text-[15px] text-[#2C2420] whitespace-pre-wrap break-words">{children ?? value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={card}>
      <h3 className="font-heading text-base font-bold text-[#2C2420] mb-1">{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function Details({ v }: { v: StaffEventView }) {
  return (
    <div className="space-y-3">
      {v.whatChanged.length > 0 && (
        <section className="bg-[#FFF8EC] rounded-2xl border border-[#E3C9A0] px-4 py-3 sm:px-5 sm:py-4">
          <h3 className="font-heading text-base font-bold text-[#2C2420] mb-1">What changed</h3>
          <ul className="space-y-1">
            {v.whatChanged.map((line, i) => (
              <li key={i} className="text-[15px] text-[#2C2420] break-words">
                {line}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Section title="Event">
        <Row label="Event" value={[v.eventName, v.eventType].filter(Boolean).join(", ")} />
        <Row label="Client" value={v.clientFirstName} />
        <Row label="Date" value={v.date} />
        <Row label="Arrive by" value={v.arrival} />
        <Row label="Bar service" value={v.serviceStart && v.serviceEnd ? `${v.serviceStart} to ${v.serviceEnd}` : v.serviceStart} />
        <Row label="Guest count" value={v.guestCount} />
        <Row label="Package" value={v.package} />
        <Row label="Bartenders" value={v.bartenders !== null ? String(v.bartenders) : ""} />
        <Row label="Also working" value={v.teammates.join(", ")} />
      </Section>

      <Section title="Location">
        {v.address && (
          <Row label="Address">
            {v.mapsUrl ? (
              <a href={v.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-[#B5845A] underline">
                {v.address}
              </a>
            ) : (
              v.address
            )}
          </Row>
        )}
        <Row label="Venue type" value={v.venueType} />
        <Row label="Bar setting" value={v.barSetting} />
        <Row label="Bar on site" value={v.barOnSite} />
        <Row label="Bar floor access" value={v.barFloorAccess} />
        <Row label="Bar details" value={v.barDetails} />
        <Row label="Parking" value={v.parking} />
      </Section>

      <Section title="Day of contact">
        <Row label="Contact" value={v.dayOfContact.name} />
        <Row label="Phone">
          {v.dayOfContact.phone ? (
            <a href={telHref(v.dayOfContact.phone)} className="text-[#B5845A] underline">
              {v.dayOfContact.phone}
            </a>
          ) : (
            <span className="text-[#6B5D52]">{v.dayOfContact.phoneNote}</span>
          )}
        </Row>
        <Row label="The Mix Fix">
          <a href={telHref(v.mixFixLine)} className="text-[#B5845A] underline">
            {v.mixFixLine}
          </a>
        </Row>
      </Section>

      <Section title="Style and notes">
        <Row label="Theme" value={v.theme} />
        <Row label="Colors" value={v.colors} />
        <Row label="Allergies" value={v.allergies.join(", ") || "None"} />
        <Row label="Beer and wine" value={v.beerAndWine} />
        <Row label="Special requests" value={v.specialRequests || "None"} />
        <Row label="Client note on bottles" value={v.bottleNote} />
      </Section>

      {v.drinks.length > 0 && (
        <section className={card}>
          <h3 className="font-heading text-base font-bold text-[#2C2420] mb-2">{v.setMenu ? "Dive Bar set menu" : "Signature drinks"}</h3>
          <ul className="space-y-3">
            {v.drinks.map((d, i) => (
              <li key={i} className="border-b border-[#DDD5CC] last:border-0 pb-3 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-heading font-bold text-[#B5845A]">{d.name}</span>
                  {d.kind && <span className="text-xs text-[#A39585] bg-[#E8DDD5] px-2 py-0.5 rounded-full shrink-0">{d.kind}</span>}
                </div>
                <ul className="mt-1 text-sm text-[#2C2420] space-y-0.5">
                  {d.ingredients.map((ing, j) => (
                    <li key={j}>{ing}</li>
                  ))}
                </ul>
                {d.cup && <p className="text-sm text-[#6B5D52] mt-1">Cup: {d.cup}</p>}
                {d.method && <p className="text-sm text-[#6B5D52] mt-1">Method: {d.method}</p>}
                {d.garnish && <p className="text-sm text-[#6B5D52]">Garnish: {d.garnish}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {v.classics && (
        <section className={card}>
          <h3 className="font-heading text-base font-bold text-[#2C2420]">Also available</h3>
          <p className="text-sm text-[#6B5D52] mb-2">Guests can also order these classics at the bar.</p>
          <div className="space-y-3">
            {v.classics.map((g) => (
              <div key={g.title}>
                <h4 className="text-xs text-[#A39585] uppercase tracking-wide mb-1">{g.title}</h4>
                <ul className="space-y-1.5">
                  {g.drinks.map((d) => (
                    <li key={d.name} className="text-sm text-[#2C2420]">
                      <span className="font-bold">{d.name}:</span> {d.recipe}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {v.lastUpdated && <p className="text-xs text-[#A39585] px-1">Last updated {v.lastUpdated}</p>}
    </div>
  );
}

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
}: {
  sessionId: string;
  groups: ResolvedGroup[];
  initial: Record<string, CheckState>;
  footer: string;
  initialConfirmedAt: string | null;
  timeZone: string;
}) {
  const [confirmedAt, setConfirmedAt] = useState(initialConfirmedAt);
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

function Supplies({ sessionId, shopping, initial, updates }: { sessionId: string; shopping: ShoppingLayout; initial: Record<string, CheckState>; updates: string[] }) {
  const { state, toggle, error } = useChecks(sessionId, "shopping", initial);
  const [missingOpen, setMissingOpen] = useState(false);
  const all = shopping.groups.flatMap((g) => g.items);

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
      <button
        type="button"
        onClick={() => setMissingOpen(true)}
        className="w-full rounded-xl border-2 border-[#B5845A] text-[#B5845A] py-3 font-medium hover:bg-[#F5F0EB]"
      >
        Something is missing
      </button>
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
  shopping,
  shoppingState,
  supplyUpdates = [],
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
}: {
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
  shopping: ShoppingLayout;
  shoppingState: Record<string, CheckState>;
  supplyUpdates?: string[]; // the Updated note on the Supplies tab
  barReady: Omit<BarReadyProps, "sessionId"> & { show: boolean };
  photoReminder?: string | null; // no bar setup photo yet after service started
  closeout?: Omit<CloseoutProps, "sessionId"> | null; // the Wrap up tab, once bar service has started
  wrapUpDone?: boolean;
  pay?: string | null; // the viewer's own estimated pay
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const chatUnread = useLiveUnread(chat.sessionId, initialTab === "chat" ? 0 : chat.unread, tab === "chat");
  useOpenChat(chat.sessionId, useCallback(() => setTab("chat"), []));
  const [wrapped, setWrapped] = useState(wrapUpDone);
  const tabs: [Tab, string][] = [
    ["details", "Details"],
    ["checklist", "Checklist"],
    ["shopping", SUPPLIES_TAB],
    ...(closeout ? ([["wrapup", WRAP_UP_TAB]] as [Tab, string][]) : []),
    ["chat", `Chat${chatUnread ? ` (${chatUnread})` : ""}`],
  ];

  return (
    <main className="max-w-2xl mx-auto px-4 py-4 sm:py-6 space-y-4">
      <div className="px-1">
        <h1 className="font-heading text-2xl font-bold text-[#2C2420] break-words">{view.eventName || view.eventType || "Event"}</h1>
        <p className="text-[15px] text-[#6B5D52]">
          {[view.date, view.arrival ? `arrive ${view.arrival}` : ""].filter(Boolean).join(", ")}
        </p>
        {pay && (
          <p className="text-sm text-[#55684A]">
            <span className="font-semibold">{pay}</span> estimated pay, before taxes and tips
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

      {photoReminder && tab !== "checklist" && (
        <section className="bg-[#FFF8EC] rounded-2xl border border-[#E3C9A0] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[15px] text-[#2C2420]">{photoReminder}</p>
          <button type="button" onClick={() => setTab("checklist")} className="text-sm font-medium text-[#9A7049] underline">
            Add the photo
          </button>
        </section>
      )}

      <nav className={`grid ${tabs.length === 5 ? "grid-cols-5" : "grid-cols-4"} gap-1 bg-[#DDD5CC] p-1 rounded-xl`} role="tablist">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
            }}
            className={`py-2 px-0.5 rounded-lg text-[13px] sm:text-sm font-medium leading-tight transition-colors ${
              tab === key ? "bg-[#F5F0EB] text-[#2C2420] shadow-sm" : "text-[#6B5D52]"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div hidden={tab !== "details"} className="space-y-4">
        {menuSection && <MenuSection menu={menuSection} />}
        <Details v={view} />
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
        />
      </div>
      <div hidden={tab !== "shopping"}>
        <Supplies sessionId={view.sessionId} shopping={shopping} initial={shoppingState} updates={supplyUpdates} />
      </div>
      {closeout && (
        <div hidden={tab !== "wrapup"}>
          <CloseoutCard sessionId={view.sessionId} {...closeout} onSent={() => setWrapped(true)} />
        </div>
      )}
      <div hidden={tab !== "chat"}>
        <ChatThread {...chat} active={tab === "chat"} />
      </div>
    </main>
  );
}
