// The Past events tab on /team/events: rows grouped by month ("November 2026")
// and then by day, in the order the server sent them (newest first). Pure, no
// imports, so the client bundle stays small.

export interface PastRow {
  id: string;
  day: string | null;
}

export interface PastDay<T> {
  day: string;
  label: string; // "Saturday, November 14"
  events: T[];
}

export interface PastMonth<T> {
  month: string; // "2026-11"
  label: string; // "November 2026"
  days: PastDay<T>[];
}

const utc = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
};

/** "November 2026" from YYYY-MM. */
export function monthLabel(ym: string): string {
  return utc(`${ym}-01`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}

/** "Saturday, November 14" from YYYY-MM-DD. The month heading carries the year. */
export function pastDayLabel(ymd: string): string {
  return utc(ymd).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
}

/** Months, then days, keeping the order given. Rows with no date are left out (they are never past). */
export function pastMonths<T extends PastRow>(rows: T[]): PastMonth<T>[] {
  const months: PastMonth<T>[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.day || seen.has(r.id)) continue;
    seen.add(r.id);
    const ym = r.day.slice(0, 7);
    let m = months.at(-1);
    if (!m || m.month !== ym) {
      m = { month: ym, label: monthLabel(ym), days: [] };
      months.push(m);
    }
    const d = m.days.at(-1);
    if (d && d.day === r.day) d.events.push(r);
    else m.days.push({ day: r.day, label: pastDayLabel(r.day), events: [r] });
  }
  return months;
}
