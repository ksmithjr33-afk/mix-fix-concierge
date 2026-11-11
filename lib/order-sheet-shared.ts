// Order sheet sections and stores, shared by the server and the order sheet
// page. No imports, so client components can use it.

export const SECTIONS = [
  { id: "liquor", title: "LIQUOR" },
  { id: "mixers", title: "MIXERS AND JUICES" },
  { id: "produce", title: "PRODUCE AND GARNISHES" },
  { id: "baseline", title: "BASELINE MIXERS" },
  { id: "ice", title: "ICE AND BAR SUPPLIES" },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];

export function isSection(v: unknown): v is SectionId {
  return SECTIONS.some((s) => s.id === v);
}

export const STORES = ["walmart", "sams", "amazon", "specs"] as const;
export type Store = (typeof STORES)[number];

/** Store highlight colors, matching the samples: Walmart light blue, Sam's Club green, Amazon orange, Spec's yellow. */
export const STORE_INFO: Record<Store, { label: string; color: string }> = {
  walmart: { label: "Walmart", color: "#BDE8F6" },
  sams: { label: "Sam's Club", color: "#BFEBB4" },
  amazon: { label: "Amazon", color: "#FFCF94" },
  specs: { label: "Spec's", color: "#FFF07D" },
};

export function isStore(v: unknown): v is Store {
  return typeof v === "string" && (STORES as readonly string[]).includes(v);
}
