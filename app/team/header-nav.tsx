"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { badgeText, currentLabel, HOME_HREF, menuHasBadge, type NavLink } from "@/lib/team/header-nav";
import ChatAlerts from "./chat-alerts";

// The header row, for everyone signed in or not.
//
// Phones and narrow screens (under 768px, md): the logo, the chat icon, the
// alert slot, and a Menu button. Menu opens a panel under the header with
// every link as a large row, then the view switch and Sign out. It closes on a
// link tap, a tap outside, Escape, navigation, or widening past 768px; focus
// goes back to the Menu button. The page scroll is locked while it is open
// and the panel overlays the page, so nothing moves.
//
// 768px and up: the links inline, the chat icon, the alert slot, and a
// dropdown under the person's first name with Me, the view switch and Sign
// out.
//
// The chat icon is rendered once for both, so its pop up and its 20 second
// inbox check run exactly once.

export interface HeaderNavProps {
  signedIn: boolean;
  firstName: string;
  links: NavLink[];
  back?: { href: string; label: string };
  /** A real admin outside Bartender view: "Bartender view". */
  canSwitch: boolean;
  /** A real admin in Bartender view: "Back to manager view". */
  canSwitchBack: boolean;
  showChat: boolean;
  /** The open slot next to the chat icon for a second alert icon (Running low, next). */
  alert?: React.ReactNode;
}

const BRAND = "text-[#9A7049] hover:text-[#B5845A]";

function Badge({ n, label, className = "" }: { n: number; label?: string; className?: string }) {
  if (n <= 0) return null;
  return (
    <span className={`inline-block min-w-[1.25rem] rounded-full bg-[#A0412D] px-1.5 text-center text-[11px] font-bold leading-[1.25rem] text-white ${className}`} aria-label={label ?? `${n}`}>
      {badgeText(n)}
    </span>
  );
}

function Burger() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function Caret() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** The view switch: a form post, as before. mode "bartender" turns Bartender view on, "admin" turns it off. */
function SwitchForm({ mode, className, onDone }: { mode: "bartender" | "admin"; className: string; onDone?: () => void }) {
  return (
    <form action="/api/team/view" method="post" onSubmit={onDone}>
      <input type="hidden" name="mode" value={mode} />
      <button type="submit" className={className}>
        {mode === "bartender" ? "Bartender view" : "Back to manager view"}
      </button>
    </form>
  );
}

function SignOutForm({ className }: { className: string }) {
  return (
    <form action="/api/team/logout" method="post">
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  );
}

/** Lock the page scroll without the page shifting when a scrollbar goes away. */
function lockScroll(): () => void {
  const body = document.body;
  const gap = window.innerWidth - document.documentElement.clientWidth;
  const prev = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  body.style.overflow = "hidden";
  if (gap > 0) body.style.paddingRight = `${gap}px`;
  return () => {
    body.style.overflow = prev.overflow;
    body.style.paddingRight = prev.paddingRight;
  };
}

export default function HeaderNav({ signedIn, firstName, links, back, canSwitch, canSwitchBack, showChat, alert }: HeaderNavProps) {
  const pathname = usePathname();
  const current = currentLabel(links, pathname);
  const panelId = useId();
  const accountId = useId();
  // Each remembers the page it was opened on, so navigating (Back and Forward
  // included) closes it with no extra render.
  const [menuAt, setMenuAt] = useState<string | null>(null);
  const [accountAt, setAccountAt] = useState<string | null>(null);
  const menuOpen = menuAt !== null && menuAt === pathname;
  const accountOpen = accountAt !== null && accountAt === pathname;
  const setMenuOpen = useCallback((v: boolean) => setMenuAt(v ? pathname : null), [pathname]);
  const setAccountOpen = useCallback((v: boolean) => setAccountAt(v ? pathname : null), [pathname]);
  const menuButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const account = useRef<HTMLDivElement>(null);
  const dot = menuHasBadge(links);

  const closeMenu = useCallback((refocus = true) => {
    setMenuAt(null);
    if (refocus) menuButton.current?.focus();
  }, []);
  const closeAccount = useCallback((refocus = true) => {
    setAccountAt(null);
    if (refocus) accountButton.current?.focus();
  }, []);

  // The phone panel: Escape, a tap outside, widening past 768px, and the scroll lock.
  useEffect(() => {
    if (!menuOpen) return;
    const unlock = lockScroll();
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || menuButton.current?.contains(t)) return;
      if ((t as HTMLElement).dataset?.menuBackdrop) return; // the backdrop closes it on click
      closeMenu(false);
    };
    const wide = window.matchMedia("(min-width: 768px)");
    const onWide = () => wide.matches && closeMenu(false);
    document.addEventListener("keydown", esc);
    document.addEventListener("pointerdown", away);
    wide.addEventListener("change", onWide);
    return () => {
      unlock();
      document.removeEventListener("keydown", esc);
      document.removeEventListener("pointerdown", away);
      wide.removeEventListener("change", onWide);
    };
  }, [menuOpen, closeMenu]);

  // The name dropdown: Escape and a click outside.
  useEffect(() => {
    if (!accountOpen) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && closeAccount();
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (account.current?.contains(t) || accountButton.current?.contains(t)) return;
      closeAccount(false);
    };
    document.addEventListener("keydown", esc);
    document.addEventListener("pointerdown", away);
    return () => {
      document.removeEventListener("keydown", esc);
      document.removeEventListener("pointerdown", away);
    };
  }, [accountOpen, closeAccount]);

  const inline = links.filter((l) => l.inline);
  const me = links.find((l) => !l.inline);
  const row = "flex min-h-[48px] items-center justify-between gap-3 px-4 text-[17px]";

  return (
    <div className="relative z-40 print:hidden">
      {/* Taps on the page while the panel is open close it and go nowhere. Under the header, over the page. */}
      {menuOpen && <div data-menu-backdrop="1" aria-hidden="true" className="fixed inset-0 -z-10 bg-[#2C2420]/25 md:hidden" onClick={() => closeMenu()} />}
      <header className="relative flex items-center justify-between gap-3 px-3 md:px-4 py-2 md:py-3 bg-[#F5F0EB] border-b border-[#DDD5CC]">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link href={HOME_HREF} className="shrink-0" aria-label="The Mix Fix, home">
            <img src="/logo.png" alt="The Mix Fix" className="h-8 md:h-10 w-auto" />
          </Link>
          {back && (
            <Link href={back.href} className="hidden md:block min-w-0 truncate text-sm text-[#6B5D52] hover:text-[#B5845A]">
              {back.label}
            </Link>
          )}
        </div>

        {signedIn && (
          <nav aria-label="Team" className="hidden md:flex shrink-0 items-center gap-x-4 lg:gap-x-5">
            {inline.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                aria-current={current === l.label ? "page" : undefined}
                className={`whitespace-nowrap text-sm font-medium ${BRAND} ${current === l.label ? "underline underline-offset-4 decoration-2" : ""}`}
              >
                {l.wideLabel ? (
                  <>
                    <span className="hidden lg:inline">{l.wideLabel}</span>
                    <span className="lg:hidden">{l.label}</span>
                  </>
                ) : (
                  l.label
                )}
                <Badge n={l.badge} label={l.badgeLabel} className="ml-1" />
              </Link>
            ))}
          </nav>
        )}

        {signedIn && (
          <div className="flex shrink-0 items-center gap-2 md:gap-3">
            {showChat && <ChatAlerts />}
            {/* The open slot for a second alert icon (Running low). Empty takes no space. */}
            <div data-header-slot="alert" className="flex items-center empty:hidden">
              {alert}
            </div>

            {/* Phones: Menu. The panel follows it in the page order, so Tab reaches it next. */}
            <button
              ref={menuButton}
              type="button"
              onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
              aria-expanded={menuOpen}
              aria-controls={panelId}
              className="md:hidden relative inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#DDD5CC] bg-white px-3 text-[15px] font-medium text-[#2C2420]"
            >
              <Burger />
              Menu
              {dot && (
                <>
                  <span data-menu-dot aria-hidden="true" className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#F5F0EB] bg-[#A0412D]" />
                  <span className="sr-only">, new items</span>
                </>
              )}
            </button>
            <div
              id={panelId}
              ref={panel}
              role="region"
              aria-label="Menu"
              className={`md:hidden absolute inset-x-0 top-full border-b border-[#DDD5CC] bg-[#F5F0EB] shadow-lg max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain transition duration-150 ease-out ${
                menuOpen ? "visible translate-y-0 opacity-100" : "invisible -translate-y-2 opacity-0 pointer-events-none"
              }`}
            >
              {back && (
                <Link href={back.href} onClick={() => closeMenu(false)} className={`${row} border-b border-[#DDD5CC] text-[#6B5D52]`}>
                  <span className="truncate">← {back.label}</span>
                </Link>
              )}
              <ul className="py-1">
                {links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      onClick={() => closeMenu(false)}
                      aria-current={current === l.label ? "page" : undefined}
                      className={`${row} font-medium ${current === l.label ? "bg-[#E8DDD5] text-[#2C2420] border-l-4 border-[#B5845A] pl-3" : "text-[#9A7049]"}`}
                    >
                      <span>{l.label}</span>
                      <Badge n={l.badge} label={l.badgeLabel} />
                    </Link>
                  </li>
                ))}
              </ul>
              {(canSwitch || canSwitchBack) && (
                <div className="border-t border-[#DDD5CC] py-1">
                  <SwitchForm mode={canSwitch ? "bartender" : "admin"} onDone={() => closeMenu(false)} className={`${row} w-full text-left text-[#2C2420]`} />
                </div>
              )}
              <div className="border-t border-[#DDD5CC] py-1">
                <SignOutForm className={`${row} w-full text-left text-[#6B5D52]`} />
              </div>
            </div>

            {/* 768px and up: the name dropdown. */}
            <div className="relative hidden md:block">
              <button
                ref={accountButton}
                type="button"
                onClick={() => (accountOpen ? closeAccount() : setAccountOpen(true))}
                aria-expanded={accountOpen}
                aria-controls={accountId}
                aria-haspopup="true"
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium ${BRAND} ${me && current === me.label ? "underline underline-offset-4 decoration-2" : ""}`}
              >
                {firstName || "Account"}
                <Caret />
              </button>
              <div
                id={accountId}
                ref={account}
                className={`absolute right-0 top-full mt-2 w-56 rounded-xl border border-[#DDD5CC] bg-[#F5F0EB] py-1 shadow-lg ${accountOpen ? "" : "hidden"}`}
              >
                {me && (
                  <Link
                    href={me.href}
                    onClick={() => closeAccount(false)}
                    aria-current={current === me.label ? "page" : undefined}
                    className={`flex items-center justify-between px-4 py-2.5 text-[15px] font-medium ${current === me.label ? "bg-[#E8DDD5] text-[#2C2420]" : "text-[#9A7049] hover:bg-[#E8DDD5]"}`}
                  >
                    {me.label}
                    <Badge n={me.badge} label={me.badgeLabel} />
                  </Link>
                )}
                {(canSwitch || canSwitchBack) && (
                  <SwitchForm mode={canSwitch ? "bartender" : "admin"} onDone={() => closeAccount(false)} className="block w-full px-4 py-2.5 text-left text-[15px] text-[#2C2420] hover:bg-[#E8DDD5]" />
                )}
                <div className="my-1 border-t border-[#DDD5CC]" />
                <SignOutForm className="block w-full px-4 py-2.5 text-left text-[15px] text-[#6B5D52] hover:bg-[#E8DDD5]" />
              </div>
            </div>
          </div>
        )}
      </header>
    </div>
  );
}
