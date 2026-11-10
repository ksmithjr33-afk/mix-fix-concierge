// What should be at the event, for the bartender's shopping list tab. Built
// from the same generated lists the team already gets: "Alcohol" from the
// client's shopping list, "Mixers, garnishes and supplies" from the supply list.
// Item, brand where the list has one, and quantity. No prices, no store names.

import { generateNatalieSupplyList, generateShoppingList } from "@/lib/shopping-list";

export interface ShopItem {
  key: string; // saved checkbox key: group and item name
  item: string;
  brand: string | null;
  quantity: string;
}

export interface StaffShopping {
  alcohol: ShopItem[];
  supplies: ShopItem[];
}

const STORES = /\b(walmart|sam'?s club|sams|spec'?s|costco|kroger|h-?e-?b|amazon|target|total wine|tossware or amazon)\b/i;

function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop "from Walmart" style store notes, keep the rest. */
function noStores(s: string): string {
  return s.replace(/\s*\(?\b(at|from|buy from|buy at)\s+[^,;()]*$/i, (m) => (STORES.test(m) ? "" : m)).trim();
}

/** "Top shelf: Grey Goose or Moderate: Titos" as "Grey Goose or Titos". */
function brandFrom(notes: string | undefined): string | null {
  const m = String(notes ?? "").match(/Top shelf:\s*(.+?)\s+or\s+Moderate:\s*(.+?)(?:\s*\(|$)/);
  return m ? `${m[1].trim()} or ${m[2].trim()}` : null;
}

const keyOf = (group: string, item: string) => `${group}:${item.toLowerCase()}`;

/** Supply list sections that are not things to bring: alcohol comes from the client list, recipes are on Details. */
const SKIP_SECTIONS = new Set(["SPIRITS", "SIGNATURE DRINK RECIPES"]);

function supplyItems(html: string): ShopItem[] {
  const out: ShopItem[] = [];
  let section: string | null = null;
  for (const raw of html.split(/<br\s*\/?>|\n/)) {
    const heading = raw.match(/^\s*<b>([^<]+)<\/b>\s*$/);
    if (heading) {
      section = heading[1].trim().toUpperCase();
      continue;
    }
    if (!section || SKIP_SECTIONS.has(section)) continue;
    const line = clean(raw);
    const at = line.indexOf(" — ");
    if (at < 0) continue;
    const item = line.slice(0, at).trim();
    const quantity = noStores(line.slice(at + 3).trim());
    if (item && !STORES.test(item)) out.push({ key: keyOf("supplies", item), item, brand: null, quantity });
  }
  return out;
}

function dedupe(items: ShopItem[]): ShopItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
}

export function buildStaffShopping(eventData: Record<string, unknown>): StaffShopping {
  const quiet = console.log;
  console.log = () => {}; // the generators log the whole event, client details included
  try {
    const ed = eventData as unknown as Parameters<typeof generateShoppingList>[0];
    const list = generateShoppingList(ed);
    const alcohol = list
      .filter((i) => i.category === "Spirits" || i.category === "Beer & Wine")
      .map((i) => ({ key: keyOf("alcohol", i.item), item: i.item, brand: brandFrom(i.notes), quantity: i.quantity }));

    // Tailored Bar has no supply list: the client buys everything, so the rest of their own list is what to expect.
    const supplyHtml = generateNatalieSupplyList(ed);
    const supplies = supplyHtml
      ? supplyItems(supplyHtml)
      : list
          .filter((i) => i.category !== "Spirits" && i.category !== "Beer & Wine")
          .map((i) => {
            const item = i.item.replace(/^[\d.]+\s*oz\s*/i, "").replace(/^./, (c) => c.toUpperCase());
            return { key: keyOf("supplies", item), item, brand: null, quantity: noStores(i.quantity) };
          });

    return { alcohol: dedupe(alcohol), supplies: dedupe(supplies) };
  } finally {
    console.log = quiet;
  }
}

export function allShopItems(s: StaffShopping): ShopItem[] {
  return [...s.alcohol, ...s.supplies];
}

/** Bartender Only and Tailored Bar: the client buys everything on the list. */
export function clientProvidesAll(pkg: unknown): boolean {
  const p = String(pkg ?? "").toLowerCase();
  return p.includes("bartender") || p.includes("tailored");
}

export const CLIENT_PROVIDES_BANNER = "The client provides everything on this list. Check on site that it is all here.";
export const ALCOHOL_TITLE = "Alcohol, provided by the client";
export const ALCOHOL_NOTE =
  "The client buys the alcohol. Check on site that everything is here, and tap Something is missing if it is not.";

export interface ShoppingGroup {
  id: "supplies" | "alcohol";
  title: string;
  note: string | null;
  items: ShopItem[];
}

/** The shopping tab layout: supplies first, alcohol last, titled by who provides them. */
export function shoppingGroups(pkg: unknown, s: StaffShopping): { banner: string | null; groups: ShoppingGroup[] } {
  const client = clientProvidesAll(pkg);
  return {
    banner: client ? CLIENT_PROVIDES_BANNER : null,
    groups: [
      {
        id: "supplies",
        title: `Mixers, garnishes and supplies, provided by ${client ? "the client" : "The Mix Fix"}`,
        note: null,
        items: s.supplies,
      },
      { id: "alcohol", title: ALCOHOL_TITLE, note: ALCOHOL_NOTE, items: s.alcohol },
    ],
  };
}
