// Memory learns after every turn (owner ruling 3 Nov 2026): once a turn completes, the chat goes to memory.capture with reason "turn", as the person whose turn it was and with the account
// the turn ran on, so memory can learn on that account's cheapest model inside the person's daily quota (modules/memory/handlers/learn.ts).
// It never slows the reply: the engine awaits onTurnEnd before it says the turn is done and posts what the agent wrote, so the hand-off is only scheduled here, on a timer, and nothing waits
// for it. A pass that fails (memory away, a provider limit) is logged and nothing else: learning is never a chat error.
// A routine's turn (nobody asked in a chat), a turn that did not complete, and a turn with no person behind it teach nothing.
import type { ResolvedAccount, TurnRow } from "../../agent/src/turn-engine/types.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;
export interface LearnHost { call: Call; log?: (msg: string, attrs?: Record<string, unknown>) => void }

/** The input memory.capture gets for a completed turn, or null when the turn teaches nothing. */
export function learnInput(turn: Readonly<TurnRow>, account: ResolvedAccount | null): Record<string, unknown> | null {
  if (turn.state !== "completed" || turn.routine || !turn.asker.startsWith("usr")) return null;
  return {
    threadId: turn.threadId, reason: "turn", turnId: turn.id, agentId: turn.agentId,
    ...(account ? { account: { ref: account.ref, driver: account.driver, kind: account.kind, payer: account.payer, ...(account.spaceKey ? { spaceKey: true } : {}) } } : {}),
  };
}

/** Hand a completed turn to memory in the background. Returns at once; the pass starts on the next turn of the event loop. */
export function learnAfterTurn(h: LearnHost, turn: Readonly<TurnRow>, account: ResolvedAccount | null): boolean {
  const input = learnInput(turn, account);
  if (!input) return false;
  const said = (e: unknown): void => h.log?.("memory did not learn from a turn", { threadId: turn.threadId, turnId: turn.id, error: e instanceof Error ? e.message : String(e) });
  const go = (): void => {
    try { void h.call("memory.capture", input, turn.asker).catch(said); } catch (e) { said(e); }
  };
  setTimeout(go, 0);
  return true;
}
