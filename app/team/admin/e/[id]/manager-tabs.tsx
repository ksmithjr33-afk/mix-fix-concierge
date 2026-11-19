"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLiveUnread, useOpenChat } from "../../../chat-focus";
import { MANAGER_TABS, type ManagerTab } from "@/lib/team/manager-tabs";

// The manager view's tab bar: one row that scrolls sideways at every width,
// each label on one line, with the open tab scrolled into view. The selected tab is in the address
// (?tab=team) so a link can open a specific tab.
//
// The server sends only the open tab's panel. Opening another tab asks the
// server for that tab (the address changes to ?tab=...), and every server
// check runs again for it. A tab already seen stays on screen, with its own
// state, while its fresh copy loads; a tab not seen yet shows a loading line.

const ActiveTab = createContext<ManagerTab>("details");

/** The tab on screen, for panels that only work while shown (the chat polls and marks read). */
export function useActiveTab(): ManagerTab {
  return useContext(ActiveTab);
}

export default function ManagerTabs({
  sessionId,
  initialTab,
  counts,
  panel,
  header,
  tabs = MANAGER_TABS,
}: {
  tabs?: readonly (readonly [ManagerTab, string])[]; // Business is added for admins only
  sessionId: string;
  initialTab: ManagerTab; // the tab the server built `panel` for
  counts: Partial<Record<ManagerTab, number>>; // something needs attention
  panel: React.ReactNode;
  header: React.ReactNode;
}) {
  const router = useRouter();
  const [, startLoading] = useTransition();
  const [tab, setTab] = useState<ManagerTab>(initialTab);
  const [panels, setPanels] = useState<Partial<Record<ManagerTab, React.ReactNode>>>({ [initialTab]: panel });
  // Each server render (a tab opened, or a refresh after a save) brings the panel for its tab.
  const [shown, setShown] = useState(panel);
  if (panel !== shown) {
    setShown(panel);
    setPanels((p) => ({ ...p, [initialTab]: panel }));
  }
  const chatUnread = useLiveUnread(sessionId, initialTab === "chat" ? 0 : (counts.chat ?? 0), tab === "chat");
  const pick = useCallback(
    (t: ManagerTab) => {
      setTab(t);
      const url = new URL(window.location.href);
      if (t === "details") url.searchParams.delete("tab");
      else url.searchParams.set("tab", t);
      startLoading(() => router.replace(`${url.pathname}${url.search}`, { scroll: false }));
    },
    [router]
  );
  useOpenChat(sessionId, useCallback(() => pick("chat"), [pick]));
  // The open tab is scrolled into view in the bar: on load, and when a tab is picked.
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const b = activeRef.current;
    const bar = b?.closest("nav");
    if (!b || !bar) return;
    const left = b.offsetLeft - bar.clientWidth / 2 + b.offsetWidth / 2;
    bar.scrollTo({ left: Math.max(0, left), behavior: "auto" });
  }, [tab]);

  return (
    <main className={`${tab === "order" ? "max-w-[52rem]" : "max-w-2xl"} mx-auto px-4 py-4 sm:py-6 space-y-4 print:max-w-none print:p-0`}>
      <div className="print:hidden">{header}</div>
      {/* One row that scrolls sideways at every width: each label on one line, never wrapped or squeezed. */}
      <nav className="relative -mx-4 px-4 overflow-x-auto overscroll-x-contain print:hidden [scrollbar-width:thin]" aria-label="Manager view" data-tab-bar>
        <div className="flex w-max gap-1.5 bg-[#DDD5CC] p-1 rounded-xl" role="tablist">
          {tabs.map(([key, label]) => {
            const n = key === "chat" ? chatUnread : (counts[key] ?? 0);
            return (
              <button
                key={key}
                ref={tab === key ? activeRef : undefined}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => pick(key)}
                className={`shrink-0 whitespace-nowrap px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === key ? "bg-[#F5F0EB] text-[#2C2420] shadow-sm" : "text-[#6B5D52]"
                }`}
              >
                {label}
                {n > 0 && (
                  <span className="ml-1 inline-block min-w-[1.25rem] rounded-full bg-[#A0412D] px-1.5 text-center text-[11px] font-bold leading-[1.25rem] text-white" aria-label={`${n} need attention`}>
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
      <ActiveTab.Provider value={tab}>
        {tabs.map(([key]) => (
          <div key={key} role="tabpanel" hidden={tab !== key} className="space-y-4">
            {panels[key] ?? (tab === key && <p className="px-1 py-6 text-center text-[15px] text-[#6B5D52]" role="status">Loading…</p>)}
          </div>
        ))}
      </ActiveTab.Provider>
    </main>
  );
}
