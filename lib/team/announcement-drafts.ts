// Announcement drafts. Pure, no database.
//
// A draft holds everything on the New announcement form: title, message, one
// picture or GIF, the Send to choices and Send now. Nothing is required to
// save one (the title is still required to send). A draft never reaches
// staff: it lives in its own table, has no recipients, and texts nobody.
//
// Autosave never writes over a draft someone else saved after the writer last
// loaded it; the writer is warned instead.

import { cleanMarkets, type Market } from "@/lib/team/markets";
import { BODY_MAX, TITLE_MAX } from "@/lib/team/announcements";

export { AUTOSAVE_MS, OPEN_DRAFT_KEY, draftTitle, draftToResume, firstLine } from "@/lib/team/announcement-drafts-view";

export type DraftAudience = "everyone" | "markets";
export type DraftStatus = "draft" | "sending" | "sent" | "deleted";

export interface DraftInput {
  title: string;
  body: string;
  audience: DraftAudience;
  markets: Market[];
  bartendersOnly: boolean;
  sendNow: boolean;
  attachmentId: string | null;
}

export interface DraftRow {
  id: string;
  title: string;
  body: string;
  audience: DraftAudience;
  markets: string[];
  bartenders_only: boolean;
  send_now: boolean;
  attachment_id: string | null;
  status: DraftStatus;
  announcement_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isDraftId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Check what the form sent. Nothing is required; only lengths and markets are checked. */
export function validateDraft(raw: Record<string, unknown>): { ok: true; value: DraftInput } | { ok: false; error: string } {
  const title = String(raw.title ?? "").replace(/\s+/g, " ").trim();
  const body = String(raw.body ?? "").replace(/\r\n/g, "\n");
  if (title.length > TITLE_MAX) return { ok: false, error: `Keep the title under ${TITLE_MAX} characters.` };
  if (body.length > BODY_MAX) return { ok: false, error: `Keep the message under ${BODY_MAX} characters.` };
  let markets: Market[] = [];
  if (Array.isArray(raw.markets) && raw.markets.length > 0) {
    const m = cleanMarkets(raw.markets);
    if (!m) return { ok: false, error: "Pick a known market." };
    markets = m;
  }
  return {
    ok: true,
    value: {
      title,
      body,
      audience: raw.audience === "markets" ? "markets" : "everyone",
      markets,
      bartendersOnly: raw.bartendersOnly === true,
      sendNow: raw.sendNow === true,
      attachmentId: typeof raw.attachmentId === "string" && raw.attachmentId ? raw.attachmentId : null,
    },
  };
}

/** Nothing written yet: no title, no message, no picture. Not worth saving. */
export const draftIsEmpty = (d: Pick<DraftInput, "title" | "body" | "attachmentId">): boolean => !d.title.trim() && !d.body.trim() && !d.attachmentId;

/** What sending a draft hands to the announcement rules. */
export function draftToAnnouncement(d: Pick<DraftRow, "title" | "body" | "audience" | "markets" | "bartenders_only" | "send_now">): Record<string, unknown> | { error: string } {
  if (d.audience === "markets" && (d.markets ?? []).length === 0) return { error: "Pick at least one market, or send to every market." };
  return { title: d.title, body: d.body, markets: d.audience === "markets" ? d.markets : [], bartendersOnly: d.bartenders_only, sendNow: d.send_now };
}

const ms = (iso: string | null | undefined): number => (iso ? new Date(iso).getTime() : NaN);

/**
 * Whether saving would write over someone else's newer edit: the draft was
 * last saved by another person, after the version this writer loaded (or the
 * writer never loaded it). Your own newer save (another tab) is not a conflict.
 */
export function isNewerEditByOther(row: Pick<DraftRow, "updated_by" | "updated_at">, me: string, baseUpdatedAt: string | null | undefined): boolean {
  if (!row.updated_by || row.updated_by === me) return false;
  if (!baseUpdatedAt) return true;
  return ms(row.updated_at) > ms(baseUpdatedAt);
}
