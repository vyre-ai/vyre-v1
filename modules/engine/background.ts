// Background work of a command-line engine (owner's rc.28 report, 16 Nov 2026): helpers the engine starts with its own background-agent tool and shell jobs it leaves running go on after the turn that
// started them ended. The CLI session tells this module when one starts, is on a step and ends (agent/src/drivers/cli/session.ts); this keeps their rows true (own-subagents.ts), wakes the agent ONCE when
// the last one has ended, and stops them when a person presses Stop. The wake is an ordinary wake turn on the account of the person who asked.
import { noteTask } from "./own-subagents.ts";
import type { Db } from "./projections.ts";
import type { SessionSpec } from "../../agent/src/turn-engine/types.ts";
import type { CliSession } from "../../agent/src/drivers/cli/session.ts";

type Hold = () => Pick<CliSession, "cancel" | "background"> | null;
/** The sessions of each chat that may hold background work, for Stop. */
const holds = new Map<string, Set<Hold>>();

export interface BackgroundOptions {
  db: Db;
  now: () => number;
  /** Wake the agent in the chat for the person (the turn engine's wake). */
  wake: (threadId: string, agentId: string, asker: string) => void;
  log?: (msg: string, attrs: Record<string, unknown>) => void;
  /** every task line of an engine in a chat, as it comes: a subagent started (the call that started it and its task id) is how a hook inside it is known */
  onTask?: (threadId: string, t: Parameters<typeof noteTask>[2]) => void;
}

/** The `background` hook of the CLI driver (agent/src/drivers/cli/driver.ts). */
export function createBackground(o: BackgroundOptions) {
  return (spec: SessionSpec, session: Hold) => {
    const where = { threadId: spec.threadId, agentId: spec.agent.id, asker: spec.asker };
    (holds.get(spec.threadId) ?? holds.set(spec.threadId, new Set()).get(spec.threadId)!).add(session);
    return {
      task: (t: Parameters<typeof noteTask>[2]): void => {
        try {
          o.onTask?.(spec.threadId, t);
        } catch {
          /* the run tree never touches the rows */
        }
        try {
          noteTask(o.db, where, t, o.now());
        } catch (e) {
          o.log?.("a background helper's step was not kept", {
            threadId: spec.threadId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },
      done: (): void => {
        try {
          o.wake(spec.threadId, spec.agent.id, spec.asker);
        } catch (e) {
          o.log?.("the agent could not be woken when its helpers finished", {
            threadId: spec.threadId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },
    };
  };
}

/** Stop the background work of one chat: the engine's process ends and takes its helpers and jobs with it. Returns how many sessions were stopped. */
export async function stopBackground(threadId: string): Promise<number> {
  const set = holds.get(threadId);
  if (!set) return 0;
  let n = 0;
  for (const get of [...set]) {
    const s = get();
    if (s === null || (s.background ?? 0) === 0) {
      set.delete(get);
      continue;
    }
    await s.cancel().catch(() => undefined);
    n += 1;
  }
  if (set.size === 0) holds.delete(threadId);
  return n;
}
