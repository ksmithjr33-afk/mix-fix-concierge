// Getting ready for an event, in two steps: 1 Tools (the "Do you have
// everything?" list, confirmed with "I have everything"), then 2 Supplies
// (the event's supplies list, confirmed with "I have gone through the
// supplies list"). Pure, no database.
//
// The steps can be done in any order: Supplies is never locked behind Tools,
// and neither step ever blocks clock in or any other tab.
// Anyone on the event with a step left gets one text 2 hours before service;
// admins and managers get one text 30 minutes before service naming who has
// not finished which step.
//
// Database names are unchanged: the Tools list is still "checklist" in
// staff_checks and staff_confirmations, and Supplies is "shopping".

import { eventSchedule, formatClock } from "@/lib/team/time";

export const TOOLS_TAB = "Tools";
export const SUPPLIES_STEP = "Supplies";
export const SUPPLIES_CONFIRM_LABEL = "I have gone through the supplies list";

export const STAFF_REMINDER_MIN = 120; // the text to the person, before service
export const ADMIN_ALERT_MIN = 30; // the text to admins and managers, before service

export interface PrepStatus {
  tools: boolean;
  supplies: boolean;
}

export interface PrepStep {
  n: 1 | 2;
  label: string; // "Tools"
  done: boolean;
}

/** The strip on the bartender event page: "1 Tools, 2 Supplies", each Done or To do. */
export function prepSteps(s: PrepStatus): PrepStep[] {
  return [
    { n: 1, label: TOOLS_TAB, done: s.tools },
    { n: 2, label: SUPPLIES_STEP, done: s.supplies },
  ];
}

/** What is left, in words: "Tools and Supplies", "Supplies", or "" when both are done. */
export function stepsLeft(s: PrepStatus): string {
  return prepSteps(s)
    .filter((p) => !p.done)
    .map((p) => p.label)
    .join(" and ");
}

/** Inside the window from `lead` minutes before service up to service start. */
function inWindow(ed: Record<string, unknown>, now: Date, lead: number): boolean {
  const start = eventSchedule(ed).start;
  if (!start) return false;
  return now.getTime() >= start.getTime() - lead * 60_000 && now.getTime() < start.getTime();
}

/** The 2 hour text to someone on the event, when either step is not done. */
export function staffReminderDue(ed: Record<string, unknown>, now: Date, s: PrepStatus): boolean {
  return !!stepsLeft(s) && inWindow(ed, now, STAFF_REMINDER_MIN);
}

/** The 30 minute text to admins and managers, when anyone on the event has a step left. */
export function adminAlertDue(ed: Record<string, unknown>, now: Date, people: PrepStatus[]): boolean {
  return people.some((p) => !!stepsLeft(p)) && inWindow(ed, now, ADMIN_ALERT_MIN);
}

export function staffReminderText(o: { firstName: string; title: string; startTime: string; left: string; link: string }): string {
  return `Hi ${o.firstName || "there"}, service for ${o.title} starts at ${o.startTime}. You still need to finish ${o.left} on the event page: ${o.link}`;
}

export function adminAlertText(o: { title: string; startTime: string; people: { name: string; left: string }[]; link: string }): string {
  return [`Not finished before service at ${o.startTime} for ${o.title}:`, ...o.people.map((p) => `${p.name}: ${p.left}`), o.link].join("\n");
}

export function startLabel(ed: Record<string, unknown>): string {
  const s = eventSchedule(ed);
  return s.startMin === null ? "the scheduled time" : formatClock(s.startMin);
}

export const noticeKeys = {
  staff: (assignmentId: string) => `prep_staff:${assignmentId}`,
  admin: (sessionId: string) => `prep_admin:${sessionId}`,
};
