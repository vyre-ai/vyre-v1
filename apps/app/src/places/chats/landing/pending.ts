// The first messages this window has just sent from a new chat, kept by the chat they started, so the chat can open on them the moment it has an id, before its own messages have loaded.
export interface PendingFirst { title: string; text: string; files: readonly string[]; lead: string; /** when this window made the chat (ms): how recent it is decides what a refused read means */ at?: number }

const held = new Map<string, PendingFirst>();

export const holdPending = (threadId: string, first: PendingFirst): void => { held.set(threadId, { at: Date.now(), ...first }); };
/** Starts the wait again (Retry). */
export const touchPending = (threadId: string): void => { const p = held.get(threadId); if (p) held.set(threadId, { ...p, at: Date.now() }); };
/** How long a chat this window just made may take to be readable on this device before the page says it could not open it. */
export const READABLE_GRACE_MS = 10_000;
export const pendingFor = (threadId: string): PendingFirst | undefined => held.get(threadId);
/** The chat has its own messages now. */
export const releasePending = (threadId: string): void => { held.delete(threadId); };

/** The words a new chat is named for: the first six of what was sent (or of the first file's name). */
export function firstWords(text: string, fileName?: string): string {
  return (text.trim() || fileName || "").split(/\s+/).slice(0, 6).join(" ");
}
