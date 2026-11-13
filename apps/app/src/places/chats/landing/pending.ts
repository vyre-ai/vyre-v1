// The first messages this window has just sent from a new chat, kept by the chat they started, so the chat can open on them the moment it has an id, before its own messages have loaded.
export interface PendingFirst { title: string; text: string; files: readonly string[]; lead: string }

const held = new Map<string, PendingFirst>();

export const holdPending = (threadId: string, first: PendingFirst): void => { held.set(threadId, first); };
export const pendingFor = (threadId: string): PendingFirst | undefined => held.get(threadId);
/** The chat has its own messages now. */
export const releasePending = (threadId: string): void => { held.delete(threadId); };

/** The words a new chat is named for: the first six of what was sent (or of the first file's name). */
export function firstWords(text: string, fileName?: string): string {
  return (text.trim() || fileName || "").split(/\s+/).slice(0, 6).join(" ");
}
