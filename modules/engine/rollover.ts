// Rollover (agent/src/transcript/rollover.ts, owner design of 0.6.9): Vyre owns the context window of every engine session that keeps its own context. At the end of each such turn this asks
// rolloverCheck whether the window is full enough to roll; if so the chat's compactor ends the session and the next turn starts a new one from the summary and the latest messages (compact.ts roll).
//   - Which chats: Claude Code, Codex and Grok keep their own session between turns. An API engine rebuilds its context from the chat every turn and has its own automatic compaction.
//   - How full: the input tokens the engine reported for the turn that just ended (the figure the meter shows); with none, an estimate from the characters said since the last roll or compaction.
//   - When: the first turn boundary where nothing waits. A queued message holds the roll for a few boundaries (ROLL.wait) unless the window is nearly full (ROLL.force). At most one roll per ROLL.gap turns.
// A Job does not hold it: crew teammates run in sessions of their own, and a session's background tasks are not visible to Vyre.
import type { TurnEngine } from "../../agent/src/turn-engine/engine.ts";
import { rolloverCheck } from "../../agent/src/transcript/compact.ts";
import { keepEvery, lastCompaction } from "./cli-sessions.ts";
import type { Compactor } from "./compact.ts";
import type { Db } from "./projections.ts";

/** Engines that hold the conversation in a session of their own. */
export const SESSION_KEEPERS: ReadonlySet<string> = new Set(["claude_code", "codex", "grok"]);

export interface RollerDeps {
  db: Db;
  engine: () => TurnEngine | null;
  compactor: () => Compactor | null;
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
}
export interface TurnDone { threadId: string; turnId: string; agentId: string }

export function createRoller(d: RollerDeps) {
  /** Turn boundaries a roll has been held over a queued message, per chat and agent. */
  const waited = new Map<string, number>();
  /** The account each recent turn ran on, told at the turn's end (the engine knows it; asking again could pick another). */
  const accounts = new Map<string, { driver: string; provider: string }>();
  return {
    ranOn(turnId: string, account: { driver: string; provider: string } | null): void {
      if (!account || !SESSION_KEEPERS.has(account.driver)) return;
      accounts.set(turnId, { driver: account.driver, provider: account.provider });
      if (accounts.size > 200) accounts.delete(accounts.keys().next().value as string);
    },
    /** Look at a chat after one of its turns completed. Returns whether it rolled. */
    async afterTurn(ev: TurnDone): Promise<boolean> {
      const engine = d.engine(), compactor = d.compactor();
      if (!engine || !compactor) return false;
      const turn = engine.turns(ev.threadId).find((t) => t.id === ev.turnId);
      if (!turn || turn.state !== "completed") return false;
      const account = accounts.get(ev.turnId);
      accounts.delete(ev.turnId);
      if (!account) return false;   // an API engine, or a turn this host did not run
      const key = `${ev.threadId}|${ev.agentId}`;
      const c = lastCompaction(d.db, ev.threadId, ev.agentId);
      const since = c ? engine.turns(ev.threadId).filter((t) => t.agentId === ev.agentId && t.state === "completed" && t.startedAt > c.at).length : null;
      const msgs = engine.messages(ev.threadId);
      const chars = msgs.filter((m) => m.threadSeq > (c?.upToSeq ?? 0)).reduce((n, m) => n + m.body.length, 0);
      const queued = engine.queue(ev.threadId).some((q) => q.state === "queued");
      // the context is what the model was shown in its last call; the turn's input tokens add up every call of it (cache reads included) and would roll a chat that is nowhere near full
      const check = rolloverCheck({ turns: () => [] }, {
        threadId: ev.threadId, ...(turn.info?.contextTokens !== undefined && turn.info.contextTokens > 0 ? { used: turn.info.contextTokens } : {}), ...(turn.info?.contextWindow !== undefined && turn.info.contextWindow > 0 ? { window: turn.info.contextWindow } : {}), chars, model: turn.model, provider: account.provider,
        blocked: queued ? "a queued message" : null, waited: waited.get(key) ?? 0, sinceRoll: since,
      });
      if (!check.roll) {
        if (check.wait) waited.set(key, (waited.get(key) ?? 0) + 1); else waited.delete(key);
        return false;
      }
      waited.delete(key);
      try {
        await compactor.roll({ threadId: ev.threadId, agentId: ev.agentId, asker: turn.asker, keep: keepEvery(d.db, ev.threadId), traceId: turn.traceId }, check.ctx.share, check.why);
        return true;
      } catch (e) {
        d.log?.("a chat could not be rolled over", { threadId: ev.threadId, error: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
  };
}
export type Roller = ReturnType<typeof createRoller>;
