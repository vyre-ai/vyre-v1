// An artifact an agent published during this person's turn opens in a new app tab, when this chat is open (owner ruling, 4 Nov). Two halves: this app says the chat is open (sites.chat_viewing, every
// half minute), and when the card arrives marked for this person (openFor, set by sites.artifact_publish only because of that report) the tab opens, once. A chat that was not open gets the card, which
// has Open. The set of cards already opened lives for the app's session, so leaving a chat and coming back does not open a second tab.

import { useEffect } from "react";

/** How often the open chat reports itself; the server counts a report for 75 seconds. */
export const VIEWING_EVERY_MS = 30_000;
/** A card older than this was not published a moment ago: it is a card to press, not a tab to open. */
export const FRESH_MS = 90_000;

interface RowLike { messageId: string; createdAt: number; blocks: readonly { type: string; data?: unknown }[] }

const opened = new Set<string>();

/** The artifact ids whose cards are fresh, marked for `me`, and not opened yet. Marks them opened. */
export function artifactsToOpen(rows: readonly RowLike[], me: string, now: number, done: Set<string> = opened): string[] {
  const out: string[] = [];
  for (const m of rows) {
    if (done.has(m.messageId) || now - m.createdAt > FRESH_MS) continue;
    for (const b of m.blocks) {
      const d = b.data as { artifactId?: unknown; openFor?: unknown } | null | undefined;
      if (b.type !== "artifact" || d?.openFor !== me || typeof d.artifactId !== "string") continue;
      done.add(m.messageId);
      out.push(d.artifactId);
    }
  }
  return out;
}

/** Tests only. */
export function forgetOpened(): void { opened.clear(); }

/** While this chat is mounted and the window is showing, say so now and every half minute. A failed report only means the card is all that happens. */
export function useChatViewing(call: (cap: string, input: unknown) => unknown, threadId: string): void {
  useEffect(() => {
    const say = (): void => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void Promise.resolve(call("sites.chat_viewing", { threadId })).catch(() => undefined);
    };
    say();
    const timer = setInterval(say, VIEWING_EVERY_MS);
    // in Node (the app's tests) a view that is never unmounted must not keep the process alive; a browser timer has no unref
    (timer as unknown as { unref?: () => void }).unref?.();
    return () => clearInterval(timer);
  }, [call, threadId]);
}

/** Open each fresh card marked for this person in a tab beside the chat. */
export function useOpenPublished(rows: readonly RowLike[] | undefined, me: string, open: (artifactId: string) => void, now: () => number = Date.now): void {
  useEffect(() => {
    if (!rows) return;
    for (const id of artifactsToOpen(rows, me, now())) open(id);
  }, [rows, me]);  // eslint-disable-line react-hooks/exhaustive-deps
}
