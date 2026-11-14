// A long chat's chapters are headed in the background after a completed turn (lane chat-chapters, 14 Nov 2026): chat.chapters_write, as the person who asked, on the account the turn ran on.
// It is scheduled on the next turn of the event loop and never awaited, so it cannot slow a reply or fail a turn. A chat of 40 messages or fewer costs the handler one count and nothing else.
import type { ResolvedAccount, TurnRow } from "../../agent/src/turn-engine/types.ts";
import type { LearnHost } from "./learn.ts";

export function chaptersAfterTurn(h: LearnHost, turn: Readonly<TurnRow>, account: ResolvedAccount | null): boolean {
  if (turn.state !== "completed" || turn.routine || !turn.asker.startsWith("usr") || !account) return false;
  const input = { threadId: turn.threadId, account: { ref: account.ref, driver: account.driver, kind: account.kind } };
  setTimeout(() => {
    try {
      void h.call("chat.chapters_write", input, turn.asker).catch((e: unknown) =>
        h.log?.("chapters were not written after a turn", {
          threadId: turn.threadId,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } catch (e) {
      h.log?.("chapters were not written after a turn", { threadId: turn.threadId, error: String(e) });
    }
  }, 0);
  return true;
}
