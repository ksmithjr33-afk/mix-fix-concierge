// The one line inviting the client to ask for a recommendation or what is most
// popular. It goes right after the menu line the first time the intake chat
// shows the menu (the start of the signature drink step) and never again: not
// for the second or third drink, and not when the menu is shown again.
// The prompt asks for it (lib/system-prompt.ts, MENU INVITE); the chat route
// makes sure of it: added when the first menu reply leaves it out, taken out of
// any later reply. No server imports.

import { MENU_INVITE } from "@/lib/system-prompt";

export { MENU_INVITE };

/** True once an earlier reply showed a menu or the invite: the invite's one chance has passed. */
export function inviteUsed(messages: { role: string; content?: unknown; menus?: unknown }[]): boolean {
  return messages.some(
    (m) => m.role === "assistant" && ((Array.isArray(m.menus) && m.menus.length > 0) || String(m.content ?? "").includes(MENU_INVITE))
  );
}

/**
 * Stream filter: passes text through, and when drop is true removes every copy
 * of the invite, even when it is split across chunks.
 */
export function createInviteFilter(drop: boolean, onText: (text: string) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      if (!drop) return onText(chunk);
      buffer += chunk;
      let at = buffer.indexOf(MENU_INVITE);
      while (at >= 0) {
        buffer = buffer.slice(0, at).replace(/[ \t]+$/, "") + buffer.slice(at + MENU_INVITE.length);
        at = buffer.indexOf(MENU_INVITE);
      }
      // Hold back only a tail that could still become the invite.
      let keep = 0;
      for (let n = Math.min(buffer.length, MENU_INVITE.length - 1); n > 0; n--) {
        if (MENU_INVITE.startsWith(buffer.slice(buffer.length - n))) {
          keep = n;
          break;
        }
      }
      const out = buffer.slice(0, buffer.length - keep);
      buffer = buffer.slice(buffer.length - keep);
      if (out) onText(out);
    },
    finish() {
      if (buffer) onText(buffer);
      buffer = "";
    },
  };
}

/** What to add at the end of a reply: the invite when this reply showed the first menu without it, else nothing. */
export function inviteToAdd(used: boolean, menusShown: number, replyText: string): string {
  if (used || menusShown === 0 || replyText.includes(MENU_INVITE)) return "";
  return replyText.trim() ? `\n\n${MENU_INVITE}` : MENU_INVITE;
}
