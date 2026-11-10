// "Who brings what" checklist. Edit the items here: the event page, the
// checkbox keys, and the progress count all come from this file.

export interface ChecklistSection {
  title: string;
  items: string[];
}

export interface ChecklistGroup {
  id: string;
  title: string;
  subtitle: string;
  sections: ChecklistSection[];
}

export const CHECKLIST: ChecklistGroup[] = [
  {
    id: "company",
    title: "The Mix Fix provides",
    subtitle: "Issued by the company, returned after",
    sections: [
      { title: "Bar station", items: ["6 ft folding tables (2)", "Black tablecloths (2)", "Large ice cooler"] },
      {
        title: "Brand and presentation",
        items: ["8x10 menu frame", "5x7 tip QR frame", "Bar mats (2)", "Garnish tray", "Napkin and straw holder"],
      },
      {
        title: "Prep and supplies",
        items: ["Juice containers (2)", "Squeeze bottles (2)", "Pour spouts", "Cutting board", "Trash bags"],
      },
    ],
  },
  {
    id: "staff",
    title: "You bring",
    subtitle: "Your personal tools, every event",
    sections: [
      { title: "Mixing", items: ["Shaker tins (3)", "Jiggers", "Strainers", "Mesh strainer", "Stirring spoon", "Muddler"] },
      { title: "Service", items: ["Ice scoop", "Wine key", "Bar knife", "2 bar towels"] },
    ],
  },
];

/** On Premium Bar this line replaces the folding tables, as info with no checkbox. */
export const FOLDING_TABLES = "6 ft folding tables (2)";
export const PREMIUM_WOODEN_BAR = "Wooden bar, delivered by the company";
export const CHECKLIST_FOOTER = "Premium Bar: the wooden bar is delivered by the company.";

export interface ChecklistLine {
  key: string; // saved checkbox key, the item name
  label: string;
  info: boolean; // shown without a checkbox, not counted
}

export interface ResolvedGroup {
  id: string;
  title: string;
  subtitle: string;
  sections: { title: string; lines: ChecklistLine[] }[];
}

export function isPremium(pkg: unknown): boolean {
  return String(pkg ?? "").toLowerCase().includes("premium");
}

/** The checklist for a package, with the Premium Bar wooden bar rule applied. */
export function checklistFor(pkg: unknown): ResolvedGroup[] {
  const premium = isPremium(pkg);
  return CHECKLIST.map((g) => ({
    id: g.id,
    title: g.title,
    subtitle: g.subtitle,
    sections: g.sections.map((s) => ({
      title: s.title,
      lines: s.items.map((item) =>
        premium && item === FOLDING_TABLES
          ? { key: PREMIUM_WOODEN_BAR, label: PREMIUM_WOODEN_BAR, info: true }
          : { key: item, label: item, info: false }
      ),
    })),
  }));
}

/** Every checkable key for a package. */
export function checklistKeys(pkg: unknown): string[] {
  return checklistFor(pkg).flatMap((g) => g.sections.flatMap((s) => s.lines.filter((l) => !l.info).map((l) => l.key)));
}
