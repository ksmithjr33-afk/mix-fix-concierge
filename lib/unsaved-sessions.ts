// Admin alerts for the concierge's final save. Pure, no database.
//
// "Finished but not saved": the conversation reached the closing message (or
// was marked completed) but the session is not submitted with event details,
// so it is missing from every team list.
//
// "Date already past when booked": the session saved fine, but its event date
// was before the day it was submitted (usually a date with no year read as
// this year), so it only shows under Past events.

import { chicagoToday, eventDay } from "@/lib/team/time";

/** The line every concierge closing message ends with (lib/system-prompt.ts). */
export const CLOSING_PATTERN = /hang tight while we gather/i;

export interface LogTail {
  session_id: string;
  client_name: string | null;
  status: string | null;
  updated_at: string | null;
  last: { role?: string; content?: string } | null; // the last message only
}

export interface SessionState {
  id: string;
  name: string | null;
  status: string | null;
  event_data: Record<string, unknown> | null;
  event_date?: string | null;
  submitted_at?: string | null;
  created_at?: string | null;
}

export interface UnsavedSession {
  sessionId: string;
  name: string;
  eventDate: string;
  finishedAt: string | null;
}

export interface PastDateSession {
  sessionId: string;
  name: string;
  eventDate: string;
  submittedAt: string;
}

export function looksFinished(log: LogTail): boolean {
  if (log.status === "completed") return true;
  return log.last?.role === "assistant" && CLOSING_PATTERN.test(String(log.last.content ?? ""));
}

function shown(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s !== "null" ? s : "";
}

/** Conversations that look finished whose session is not submitted with event details. */
export function finishedNotSaved(logs: LogTail[], sessions: SessionState[]): UnsavedSession[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const out: UnsavedSession[] = [];
  for (const log of logs) {
    if (!looksFinished(log)) continue;
    const s = byId.get(log.session_id);
    // No session row at all: a chat opened without a booking link, nothing to list on the team side.
    if (!s) continue;
    if (s.status === "submitted" && s.event_data) continue;
    out.push({
      sessionId: log.session_id,
      name: shown(s.name) || shown(log.client_name) || "Unknown client",
      eventDate: shown(s.event_data?.event_date) || shown(s.event_date) || "no date",
      finishedAt: log.updated_at,
    });
  }
  return out.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
}

/** Submitted sessions whose event day was already before the day the client started the concierge. */
export function bookedWithPastDate(sessions: SessionState[], hidden: Set<string> = new Set()): PastDateSession[] {
  const out: PastDateSession[] = [];
  for (const s of sessions) {
    if (s.status !== "submitted" || !s.event_data || !s.submitted_at || hidden.has(s.id)) continue;
    const day = eventDay(s.event_data.event_date);
    if (!day) continue;
    // Against when the client started, so an old session whose submitted time was stamped later is not flagged.
    // sessions.created_at has no time zone suffix; it is UTC.
    const started = s.created_at ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s.created_at) ? s.created_at : `${s.created_at}Z`) : null;
    const submitted = new Date(s.submitted_at);
    const booked = started && !isNaN(started.getTime()) && started < submitted ? started : submitted;
    if (day < chicagoToday(booked)) {
      out.push({ sessionId: s.id, name: shown(s.name) || shown(s.event_data.client_name) || "Unknown client", eventDate: day, submittedAt: s.submitted_at });
    }
  }
  return out.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}
