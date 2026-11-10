// Shared by the update mode page and the chat route. No server imports here.

/** Hidden first user turn so the API conversation starts with the user. */
export const UPDATE_OPENER = "I already submitted my event and want to make a change.";

export function updateGreeting(clientName: string | null | undefined): string {
  const first = (clientName ?? "").trim().split(/\s+/)[0];
  return `Hey${first ? ` ${first}` : ""}! Your event details are listed below. What would you like to change?`;
}
