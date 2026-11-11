"use client";

import { createContext, useContext, useState } from "react";
import { MANAGER_TABS, type ManagerTab } from "@/lib/team/manager-tabs";

// The manager view's tab bar: the same look and spacing as the bartender
// view's, scrolling sideways on a phone. The selected tab is in the address
// (?tab=team) so a link can open a specific tab.

const ActiveTab = createContext<ManagerTab>("details");

/** The tab on screen, for panels that only work while shown (the chat polls and marks read). */
export function useActiveTab(): ManagerTab {
  return useContext(ActiveTab);
}

export default function ManagerTabs({
  initialTab,
  counts,
  panels,
  header,
}: {
  initialTab: ManagerTab;
  counts: Partial<Record<ManagerTab, number>>; // something needs attention
  panels: Record<ManagerTab, React.ReactNode>;
  header: React.ReactNode;
}) {
  const [tab, setTab] = useState<ManagerTab>(initialTab);
  const [seen, setSeen] = useState<ManagerTab[]>(initialTab === "chat" ? ["chat"] : []);
  const pick = (t: ManagerTab) => {
    setTab(t);
    if (t === "chat") setSeen((s) => [...s, "chat"]);
    const url = new URL(window.location.href);
    if (t === "details") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.toString());
  };

  return (
    <main className={`${tab === "order" ? "max-w-[52rem]" : "max-w-2xl"} mx-auto px-4 py-4 sm:py-6 space-y-4 print:max-w-none print:p-0`}>
      <div className="print:hidden">{header}</div>
      <nav className="-mx-4 px-4 overflow-x-auto print:hidden" aria-label="Manager view">
        <div className="flex sm:grid sm:grid-cols-6 gap-1 bg-[#DDD5CC] p-1 rounded-xl min-w-max sm:min-w-0" role="tablist">
          {MANAGER_TABS.map(([key, label]) => {
            const n = key === "chat" && seen.includes("chat") ? 0 : (counts[key] ?? 0);
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => pick(key)}
                className={`shrink-0 whitespace-nowrap px-3 sm:px-1 py-2 rounded-lg text-sm font-medium transition-colors ${
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
        {MANAGER_TABS.map(([key]) => (
          <div key={key} role="tabpanel" hidden={tab !== key} className="space-y-4">
            {panels[key]}
          </div>
        ))}
      </ActiveTab.Provider>
    </main>
  );
}
