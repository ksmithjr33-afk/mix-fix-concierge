// Menu images in chat. The bot writes [MENU:specialty] or [MENU:classics] on its
// own line. The chat route takes those out of the text stream and sends them as
// separate events, so markers never reach transcripts, notes, or emails. No server
// imports here, the chat pages use this file too.

export type MenuKey = "specialty" | "classics";

export const MENU_INFO: Record<MenuKey, { src: string; caption: string; width: number; height: number }> = {
  specialty: { src: "/menus/specialty-menu.png", caption: "Our Specialty Cocktail Menu", width: 2550, height: 3300 },
  classics: { src: "/menus/classics-menu.png", caption: "Our Classics Menu", width: 2550, height: 3300 },
};

export const MENU_COPY =
  "Here is our actual menu so you can see what we make. Pick anything on it, or tell me a spirit and I will suggest from it.";

/** Keeps only menus we know how to show, for messages restored from storage. */
export function knownMenus(menus: unknown): MenuKey[] {
  return Array.isArray(menus) ? menus.filter((m): m is MenuKey => m === "specialty" || m === "classics") : [];
}

/**
 * Which menus a package may show. diveMenuRequested is unknown (undefined) during
 * intake, where the prompt holds that rule until the client has answered. An
 * unknown package keeps both, since the prompt still applies its package rules.
 */
export function allowedMenus(pkg: unknown, diveMenuRequested?: unknown): MenuKey[] {
  const p = String(pkg ?? "").toLowerCase();
  if (p.includes("dive")) return diveMenuRequested === false ? [] : ["classics"];
  if (p.includes("essentials") || p.includes("big day") || p.includes("wedding bar")) return ["specialty"];
  const legacyOrUpgraded = ["bartender", "tailored", "full", "premium"].some((k) => p.includes(k));
  if (p.includes("beer") && p.includes("wine") && !legacyOrUpgraded) return [];
  return ["specialty", "classics"];
}

const MARKER = /\[MENU:(specialty|classics)\]/;
const TOKENS = ["[MENU:specialty]", "[MENU:classics]"];

/**
 * Stream filter: text comes out with markers removed, even when a marker is split
 * across chunks, and without the blank lines the marker's line leaves behind. A
 * package's disallowed menu is dropped, and a menu shows once per message.
 */
export function createMenuFilter(
  allowed: readonly MenuKey[],
  onText: (text: string) => void,
  onMenu: (menu: MenuKey) => void
) {
  const shown: MenuKey[] = [];
  let buffer = "";
  let heldSpace = "";
  let afterMarker = false;
  let written = "";

  const emit = (text: string) => {
    written += text;
    onText(text);
  };

  const write = (raw: string) => {
    let s = raw;
    if (afterMarker) {
      s = s.trimStart();
      if (!s) return;
      afterMarker = false;
      heldSpace = written ? "\n\n" : "";
    }
    const body = s.trimEnd();
    const trailing = s.slice(body.length);
    if (!body) {
      heldSpace += trailing;
      return;
    }
    emit(heldSpace + body);
    heldSpace = trailing;
  };

  const show = (menu: MenuKey) => {
    if (!allowed.includes(menu) || shown.includes(menu)) return;
    shown.push(menu);
    onMenu(menu);
  };

  const flush = () => {
    write(buffer);
    buffer = "";
    heldSpace = "";
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      let match = MARKER.exec(buffer);
      while (match) {
        write(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        heldSpace = "";
        afterMarker = true;
        show(match[1] as MenuKey);
        match = MARKER.exec(buffer);
      }
      // Hold back only what could still become a marker.
      const open = buffer.lastIndexOf("[");
      const partial = open >= 0 && TOKENS.some((t) => t.startsWith(buffer.slice(open)));
      write(partial ? buffer.slice(0, open) : buffer);
      buffer = partial ? buffer.slice(open) : "";
    },
    flush,
    /** End of the reply. The copy without a marker still gets its image, and an image always gets its copy. */
    finish() {
      flush();
      if (shown.length === 0 && written.includes(MENU_COPY.slice(0, 24))) allowed.forEach(show);
      if (shown.length > 0 && !written.trim()) emit(MENU_COPY);
    },
    menus: () => [...shown],
  };
}
