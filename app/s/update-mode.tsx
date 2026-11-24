"use client";

import { useEffect, useRef, useState } from "react";
import EventSummary from "./event-summary";
import ShoppingList from "./shopping-list";
import { UPDATE_OPENER, updateGreeting } from "@/lib/update-mode-shared";
import MenuCards from "@/app/menu-card";
import type { MenuKey } from "@/lib/menu-markers";
import { ExtraDrinkButtons } from "./client-asks";
import { type ClientAsks as Asks } from "@/lib/team-notes";
import { ASK_BUTTON, buildTodo, countdown, dayLines, homeTitle, leftToDo, listLine, statusLine, type TodoItem } from "@/lib/event-home";
import type { HomeData } from "@/lib/event-home-db";
import { AgreementCard, BarTeam, Checklist, HelpCard, HomeCard, HomeTop, PaymentCard, RequestsCard, YourDay } from "@/app/_event-home/sections";
import { CHANGE_MESSAGES } from "./event-summary";

interface Message {
  role: "user" | "assistant";
  content: string;
  menus?: MenuKey[];
}

type EventData = Record<string, unknown>;

function formatUpdated(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function UpdateMode({
  sessionId,
  clientName,
  initialEventData,
  initialVersion,
  initialUpdatedAt,
  initialMessages,
  showList = false,
  listPending = false,
  menu = null,
  extra = null,
  cups = false,
  noBarback = false,
  serviceFee = false,
  initialAsks = null,
  home = null,
  badge = null,
}: {
  home?: HomeData | null; // the countdown, bar team, payment, agreement, requests and list timing (lib/event-home-db.ts)
  badge?: React.ReactNode; // the surprise label, under the title
  initialAsks?: Asks | null; // the client's own questions: finish the drink menu, the extra drink
  cups?: boolean; // custom cups promised on an older Full Bar booking (sessions.package_extras)
  noBarback?: boolean; // a barback was never part of this booking (sessions.package_extras.barback_not_booked)
  serviceFee?: boolean; // the booking is on the service fee model: Bartender Only shows the new package wording
  extra?: React.ReactNode; // the planners card, on client held events
  menu?: { type: string; typeLabel: string; viewHref: string; downloadHref: string } | null; // "Your menu": the approved menu, once uploaded
  sessionId: string;
  clientName: string | null;
  initialEventData: EventData;
  initialVersion: number;
  initialUpdatedAt: string | null;
  initialMessages: Message[];
  showList?: boolean; // auto send is on and the first list is out
  listPending?: boolean; // a change request made inside 6 days is waiting for approval
}) {
  const [messages, setMessages] = useState<Message[]>(
    initialMessages.length > 0
      ? initialMessages
      : [{ role: "assistant", content: updateGreeting(clientName) }]
  );
  const [eventData, setEventData] = useState<EventData>(initialEventData);
  const [version, setVersion] = useState(initialVersion);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [pending, setPending] = useState(listPending);
  const [asks, setAsks] = useState<Asks | null>(initialAsks);
  const chatRef = useRef<HTMLElement>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestError, setGuestError] = useState("");
  // The version this chat opened on: the final recap covers every change saved after it.
  const [chatStartVersion] = useState(initialVersion);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Scroll the chat panel only, not the whole page.
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const streamResponse = async (visible: Message[]) => {
    setIsStreaming(true);
    setMessages([...visible, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: UPDATE_OPENER }, ...visible],
          sessionId,
          chatStartVersion,
        }),
      });
      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let fullText = "";
      let menus: MenuKey[] = [];
      let buffer = "";

      const showAssistant = () =>
        setMessages([...visible, { role: "assistant", content: fullText, ...(menus.length > 0 ? { menus } : {}) }]);

      const processFrame = (data: string) => {
        if (data === "[DONE]") return;
        let parsed: {
          text?: string;
          error?: string;
          event?: string;
          eventData?: EventData;
          asks?: Asks;
          version?: number;
          updatedAt?: string | null;
          menu?: MenuKey;
        };
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
        if (parsed.error) {
          console.error("Stream error:", parsed.error);
          return;
        }
        if (parsed.event === "updated") {
          if (parsed.eventData) setEventData(parsed.eventData);
          if (parsed.asks) setAsks(parsed.asks);
          if (typeof parsed.version === "number") setVersion(parsed.version);
          if (parsed.updatedAt) setUpdatedAt(parsed.updatedAt);
          return;
        }
        if (parsed.event === "held") {
          setPending(true);
          return;
        }
        if (parsed.event === "menu" && parsed.menu) {
          menus = [...menus, parsed.menu];
          showAssistant();
          return;
        }
        if (typeof parsed.text === "string") {
          fullText += parsed.text;
          showAssistant();
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (line) processFrame(line.slice(6));
        }
      }
      const last = buffer.split("\n").find((l) => l.startsWith("data: "));
      if (last) processFrame(last.slice(6));
    } catch (error) {
      console.error("Fetch error:", error);
    } finally {
      setIsStreaming(false);
      inputRef.current?.focus();
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    await streamResponse([...messages.filter((m) => m.content), { role: "user", content: text }]);
  };

  // The chat stays closed until a button opens it: with a topic, it starts on that topic; the top button opens it empty.
  const openChat = async (message?: string) => {
    setChatOpen(true);
    setTimeout(() => {
      chatRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (!message) inputRef.current?.focus();
    }, 50);
    if (!message || isStreaming) return;
    await streamResponse([...messages.filter((m) => m.content), { role: "user", content: message }]);
  };

  const confirmGuests = async (count: string) => {
    setGuestBusy(true);
    setGuestError("");
    try {
      const res = await fetch("/api/client-guest-count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, count }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setGuestError(data.error ?? "Could not save. Try again.");
      else if (data.eventData) setEventData(data.eventData);
    } catch {
      setGuestError("Could not reach the server. Try again.");
    } finally {
      setGuestBusy(false);
    }
  };

  const todo = buildTodo(eventData, { asks, balance: home?.balance ?? null, past: home?.past ?? false });
  const button = "rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40";
  const renderAction = (it: TodoItem) => {
    const a = it.action;
    if (!a) return null;
    if (a.kind === "chat")
      return (
        <button type="button" onClick={() => openChat(a.message)} disabled={isStreaming} className={`${button} bg-[#B5845A] text-white`}>
          {a.button}
        </button>
      );
    if (a.kind === "extra_drink")
      return (
        <ExtraDrinkButtons
          sessionId={sessionId}
          disabled={isStreaming}
          onAnswered={(r, line) => {
            setEventData(r.eventData);
            setAsks(r.asks);
            setVersion(r.version);
            if (r.updatedAt) setUpdatedAt(r.updatedAt);
            if (r.pending) setPending(true);
            setNotice(line);
          }}
        />
      );
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => confirmGuests(a.count)} disabled={guestBusy || isStreaming} className={`${button} bg-[#B5845A] text-white`}>
            {a.button}
          </button>
          <button type="button" onClick={() => openChat(a.changeMessage)} disabled={isStreaming} className={`${button} border border-[#2C2420] text-[#2C2420]`}>
            Change it
          </button>
        </div>
        {guestError && <p className="text-sm text-[#A0412D]">{guestError}</p>}
      </div>
    );
  };

  const lastUpdated = formatUpdated(updatedAt);

  return (
    <div className="min-h-dvh bg-[#E8DDD5]">
      <header className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 bg-[#F5F0EB] border-b border-[#DDD5CC]">
        <img src="/logo.png" alt="The Mix Fix" className="h-8 sm:h-10" />
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 sm:py-6 space-y-4">
        {/* 1. Top: the event, the countdown, and one status line. */}
        <HomeTop
          title={homeTitle(eventData)}
          date={home?.date || String(eventData.event_date ?? "")}
          countdown={countdown(home?.daysUntil ?? null)}
          status={statusLine(leftToDo(todo), home?.daysUntil ?? null)}
          badge={badge}
        >
          <button type="button" onClick={() => openChat()} className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium hover:bg-[#9A7049]">
            {ASK_BUTTON}
          </button>
        </HomeTop>

        {/* 2. What we need from you. */}
        <Checklist items={todo} renderAction={renderAction} />
        {notice && <p className="px-1 text-sm text-[#2C2420]">{notice}</p>}

        {/* 3. The chat: closed until a button opens it. */}
        <section ref={chatRef} aria-label="Chat with us" aria-hidden={!chatOpen} className={`${chatOpen ? "flex" : "hidden"} scroll-mt-4 flex-col h-[60dvh] min-h-[360px] bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] overflow-hidden`}>
          <div className="px-4 py-2.5 border-b border-[#DDD5CC]">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-heading text-base font-bold text-[#2C2420]">Change something or ask a question</h2>
              <button type="button" onClick={() => setChatOpen(false)} className="text-sm text-[#6B5D52] underline">
                Close
              </button>
            </div>
            <p className="text-xs text-[#6B5D52] mt-0.5 leading-snug">
              Changes save right away up to 6 days before your event. After that, a change to your drink
              menu or shopping list is sent to our team for approval.
            </p>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages
              .filter((m) => m.content.length > 0 || (isStreaming && m.role === "assistant"))
              .map((msg, i) => (
                <div key={i} className="space-y-2">
                <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[88%] px-3.5 py-2.5 rounded-2xl text-[15px] leading-relaxed whitespace-pre-wrap break-words ${
                      msg.role === "user"
                        ? "bg-[#B5845A] text-white rounded-br-md"
                        : "bg-[#E8DDD5] text-[#2C2420] rounded-bl-md"
                    }`}
                  >
                    {msg.content || (
                      <span className="inline-block w-1.5 h-4 bg-[#B5845A] animate-pulse rounded-sm align-text-bottom" />
                    )}
                  </div>
                </div>
                <MenuCards menus={msg.menus} className="w-[88%] max-w-md" />
                </div>
              ))}
          </div>
          <div className="border-t border-[#DDD5CC] px-3 py-2.5 flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              onInput={() => {
                const el = inputRef.current;
                if (el) {
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 120) + "px";
                }
              }}
              placeholder="What would you like to change?"
              rows={1}
              disabled={isStreaming}
              className="flex-1 resize-none rounded-xl border border-[#DDD5CC] bg-[#E8DDD5] px-3.5 py-2.5 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]"
            />
            <button
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              aria-label="Send"
              className="flex items-center justify-center w-11 h-11 rounded-xl bg-[#B5845A] text-white disabled:opacity-40 hover:bg-[#9A7049] transition-colors shrink-0"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
          </div>
        </section>

        {/* 4. Your day. */}
        <YourDay
          lines={dayLines(eventData)}
          address={String(eventData.event_address ?? "").trim()}
          contact={[eventData.day_of_contact_name, eventData.day_of_contact_phone].map((v) => String(v ?? "").trim()).filter((v) => v && v !== "null").join(", ")}
        />

        {/* 5. Your plan, with a Change button on each part, and the requests waiting on our team. */}
        <div id="event-details" className="scroll-mt-4">
          <div className="flex items-baseline justify-between mb-2 px-1">
            <h2 className="font-heading text-lg font-bold text-[#2C2420]">Your plan</h2>
            {lastUpdated && (
              <span className="text-xs text-[#A39585]">
                Last updated {lastUpdated} (version {version})
              </span>
            )}
          </div>
          {pending && (
            <p className="mb-2 rounded-xl border border-[#E3C9A0] bg-[#FFF8EC] px-3 py-2 text-sm text-[#6B5D52]">
              A change you asked for is waiting for our team&apos;s approval. It is not confirmed yet, and the details below do not include it.
            </p>
          )}
          <EventSummary
            data={eventData}
            cups={cups}
            noBarback={noBarback}
            serviceFee={serviceFee}
            onChange={(t) => openChat(CHANGE_MESSAGES[t])}
          />
        </div>
        {home && <RequestsCard requests={home.requests} />}

        {/* 6. Your menu. */}
        {menu && (
          <section id="your-menu" className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4 space-y-3" aria-label="Your menu">
            <h2 className="font-heading text-lg font-bold text-[#2C2420]">Your menu</h2>
            {menu.type !== "application/pdf" && (
              <a href={menu.viewHref} target="_blank" rel="noopener noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={menu.viewHref} alt="Your approved cocktail menu" className="max-h-[28rem] w-auto max-w-full rounded-lg border border-[#DDD5CC] bg-white" />
              </a>
            )}
            <div className="flex flex-wrap gap-3">
              <a href={menu.viewHref} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium">
                View{menu.type === "application/pdf" ? " (PDF)" : ""}
              </a>
              <a href={menu.downloadHref} className="rounded-lg border border-[#2C2420] text-[#2C2420] px-4 py-2 text-sm font-medium">
                Download
              </a>
            </div>
          </section>
        )}

        {/* 7. Your shopping list, or when to expect it. */}
        {showList ? (
          <ShoppingList data={eventData} pending={pending} />
        ) : home && listLine(home.listTiming) ? (
          <HomeCard title="Your shopping list" id="shopping-list">
            <p className="text-[15px] text-[#6B5D52]">{listLine(home.listTiming)}</p>
          </HomeCard>
        ) : null}

        {/* 8. Your bar team. 9. Payment. 10. Your agreement. */}
        {home && <BarTeam team={home.team} />}
        {home && <PaymentCard payment={home.payment} lines={home.paymentLines} />}
        {home && (
          <AgreementCard
            agreements={home.agreements}
            href={(id, download) => `/api/agreement?id=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(id)}${download ? "&download=1" : ""}`}
          />
        )}

        {/* 11. Planners. */}
        {extra}

        {/* 12. Help. */}
        <HelpCard />
      </main>
    </div>
  );
}
