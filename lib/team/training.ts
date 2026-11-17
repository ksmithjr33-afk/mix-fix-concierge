// The Training page (/team/training): sections of things to read and
// acknowledge, each with its own "X of Y" count. Pure, no database.
//
// Built as a list of sections so more can be added later without
// restructuring: add an entry to TRAINING_SECTIONS with its items and the id
// each acknowledgement is stored under. Every acknowledgement lives in
// staff_onboarding (staff_id, item_id): Getting started keeps its original ids
// ("name_phone"), packages are "package:<key>" ("package:full").
//
// 1. Getting started: the five onboarding steps, moved here unchanged.
// 2. Packages: one entry per package guide (lib/packages-info.ts), legacy last.

import { ONBOARDING, ONBOARDING_INTRO, ONBOARDING_TITLE } from "@/lib/team/cert-config";
import { currentGuides, legacyGuides, trainingAnchor } from "@/lib/packages-info";

export const TRAINING_TITLE = "Training";
export const TRAINING_PATH = "/team/training";
export const MARK_READ = "Mark as read";

export interface TrainingItem {
  ackId: string; // what staff_onboarding.item_id holds
  title: string;
  href?: string; // its own page (Getting started steps)
  anchor?: string; // its spot on the Training page (packages)
  group?: string; // "Legacy packages"
}

export interface TrainingSection {
  id: string; // "getting-started"
  title: string;
  intro: string;
  countWord: string; // "done" or "read": "3 of 5 done"
  items: TrainingItem[];
}

export const packageAckId = (key: string) => `package:${key}`;

export const TRAINING_SECTIONS: TrainingSection[] = [
  {
    id: "getting-started",
    title: ONBOARDING_TITLE,
    intro: ONBOARDING_INTRO,
    countWord: "done",
    items: ONBOARDING.map((i) => ({ ackId: i.id, title: i.title, href: `/team/onboarding/${i.id}` })),
  },
  {
    id: "packages",
    title: "Packages",
    intro: "What each package includes, how service runs, what to say when a guest asks for something the package does not include, and how setup differs. Open each one and tap Mark as read.",
    countWord: "read",
    items: [
      ...currentGuides().map((g) => ({ ackId: packageAckId(g.key), title: g.name, anchor: trainingAnchor(g.key) })),
      ...legacyGuides().map((g) => ({ ackId: packageAckId(g.key), title: g.name, anchor: trainingAnchor(g.key), group: "Legacy packages" })),
    ],
  },
];

export interface SectionProgress {
  id: string;
  title: string;
  done: number;
  total: number;
  text: string; // "3 of 5 done"
}

/** Each section's count, from the acknowledged ids. Only items still on the page count. */
export function trainingProgress(acked: { has: (id: string) => boolean }): SectionProgress[] {
  return TRAINING_SECTIONS.map((s) => {
    const done = s.items.filter((i) => acked.has(i.ackId)).length;
    return { id: s.id, title: s.title, done, total: s.items.length, text: `${done} of ${s.items.length} ${s.countWord}` };
  });
}

/** The Training badge in the header: everything not yet read or acknowledged. */
export function trainingUnread(acked: { has: (id: string) => boolean }): number {
  return trainingProgress(acked).reduce((n, p) => n + (p.total - p.done), 0);
}

/** "Getting started 3 of 5 · Packages 2 of 8", for the staff list and profile. */
export function progressLine(p: SectionProgress[]): string {
  return p.map((s) => `${s.title} ${s.done} of ${s.total}`).join(" · ");
}

/** Is this id something the Training page can acknowledge? */
export function isTrainingAck(id: string): boolean {
  return TRAINING_SECTIONS.some((s) => s.items.some((i) => i.ackId === id));
}
