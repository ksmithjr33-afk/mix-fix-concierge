// Announcement draft helpers the browser uses too. Pure, no imports, so the
// form does not pull server code into the page.

/** How long after the last keystroke the form saves itself. */
export const AUTOSAVE_MS = 2500;

/** The browser remembers which draft was open, so coming back reopens it. */
export const OPEN_DRAFT_KEY = "mixfix.openAnnouncementDraft";

/** "Untitled" for a draft with no title yet. */
export const draftTitle = (title: string): string => title.trim() || "Untitled";

/** The first line of the message, for the Drafts list. */
export function firstLine(body: string, max = 120): string {
  const line = (body.split("\n").find((l) => l.trim()) ?? "").trim();
  return line.length > max ? `${line.slice(0, max - 3).trimEnd()}...` : line;
}

/** The draft to reopen when someone comes back to the page: the one they had open, if it is still a draft. */
export function draftToResume<T extends { id: string }>(storedId: string | null | undefined, drafts: T[]): T | null {
  if (!storedId) return null;
  return drafts.find((d) => d.id === storedId) ?? null;
}
