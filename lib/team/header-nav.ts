// The team portal header's links: which ones each person gets, which one is the
// current page, and the count badges. Pure, no database, so the test scripts
// can check it. The header (app/team/team-header.tsx) reads the counts and the
// links render in app/team/header-nav.tsx.
//
// Everyone starts with Home: the same place the logo goes (HOME_HREF), the
// current page there. Staff keep Events too; on the home page Home is the
// current one, on an event, shift, or handoff page Events is.
// Admins and managers: Staffing, Staff, Clients, Partners, Time, Scorecard, News, Training, Me.
// Admins (role admin, never managers) also get Business and Payroll, after Time (before Scorecard).
// Everyone else, and admins in Bartender view: Events, Training, News, Me.
// Training has a badge for anything not yet read or acknowledged.
// On phones every link is a row in the Menu panel; on wider screens all but Me
// are inline and Me sits in the dropdown under the person's first name.

export interface NavLink {
  href: string;
  label: string; // the phone panel, and inline at tablet widths
  wideLabel?: string; // inline on wide screens ("Announcements")
  badge: number; // 0 for none
  badgeLabel?: string; // "3 unread", for screen readers
  match: string[]; // path prefixes that make this the current page
  inline: boolean; // shown inline on wider screens (Me is in the name dropdown)
}

export interface NavCounts {
  unreadNews: number;
  training?: number; // Training items not yet read or acknowledged
}

/** Where the logo and Home go, for every role: the events home screen. */
export const HOME_HREF = "/team/events";

const prefixMatch = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** The links for one viewer, in order. showAdmin: an admin, not in Bartender view, on an admin page set. */
export function headerLinks(showAdmin: boolean, counts: NavCounts, showBusiness = false): NavLink[] {
  const news: NavLink = {
    href: "/team/announcements",
    label: "News",
    wideLabel: "Announcements",
    badge: Math.max(0, counts.unreadNews | 0),
    badgeLabel: counts.unreadNews > 0 ? `${counts.unreadNews} unread` : undefined,
    match: ["/team/announcements"],
    inline: true,
  };
  const me: NavLink = {
    href: "/team/me",
    label: "Me",
    badge: 0,
    // The pages reached from Me (their back link says "Me").
    match: ["/team/me", "/team/pay", "/team/record", "/team/availability", "/team/certifications"],
    inline: false,
  };
  const trainingCount = Math.max(0, (counts.training ?? 0) | 0);
  const training: NavLink = {
    href: "/team/training",
    label: "Training",
    badge: trainingCount,
    badgeLabel: trainingCount > 0 ? `${trainingCount} to read` : undefined,
    match: ["/team/training", "/team/onboarding"],
    inline: true,
  };
  const home: NavLink = { href: HOME_HREF, label: "Home", badge: 0, match: [HOME_HREF], inline: true };
  if (showAdmin) {
    return [
      home,
      { href: "/team/admin/events", label: "Staffing", badge: 0, match: ["/team/admin/events", "/team/admin/e", "/team/admin/preview", "/team/admin/stores", "/team/admin/leftovers"], inline: true },
      { href: "/team/admin/staff", label: "Staff", badge: 0, match: ["/team/admin/staff", "/team/admin/syrups"], inline: true },
      { href: "/team/admin/clients", label: "Clients", badge: 0, match: ["/team/admin/clients"], inline: true },
      { href: "/team/admin/partners", label: "Partners", badge: 0, match: ["/team/admin/partners"], inline: true },
      { href: "/team/admin/timesheets", label: "Time", badge: 0, match: ["/team/admin/timesheets"], inline: true },
      ...(showBusiness
        ? [
            { href: "/team/admin/business", label: "Business", badge: 0, match: ["/team/admin/business", "/team/admin/receipts"], inline: true },
            { href: "/team/admin/payroll", label: "Payroll", badge: 0, match: ["/team/admin/payroll"], inline: true },
          ]
        : []),
      { href: "/team/admin/scorecard", label: "Scorecard", badge: 0, match: ["/team/admin/scorecard"], inline: true },
      news,
      training,
      me,
    ];
  }
  return [home, { href: "/team/events", label: "Events", badge: 0, match: ["/team/events", "/team/e", "/team/shifts", "/team/handoff"], inline: true }, training, news, me];
}

/** The link for the page being viewed: the longest matching prefix wins, the earlier link on a tie (Home over Events). Null when none matches. */
export function currentHref(links: NavLink[], pathname: string | null): string | null {
  const label = currentLabel(links, pathname);
  return links.find((l) => l.label === label)?.href ?? null;
}

/**
 * The label of the link for the page being viewed, the same rule as
 * currentHref. The header marks by label because Home and Events share an
 * address for staff and only one of them is the current page.
 */
export function currentLabel(links: NavLink[], pathname: string | null): string | null {
  if (!pathname) return null;
  let best: { label: string; len: number } | null = null;
  for (const l of links) {
    for (const m of l.match) {
      if (prefixMatch(pathname, m) && (!best || m.length > best.len)) best = { label: l.label, len: m.length };
    }
  }
  return best?.label ?? null;
}

/** The dot on the Menu button: any row in the panel has a badge. */
export function menuHasBadge(links: NavLink[]): boolean {
  return links.some((l) => l.badge > 0);
}

/** "99+" past 99, like the chat icon. */
export function badgeText(n: number): string {
  return n > 99 ? "99+" : String(n);
}
