// A new engine session when the people who read a chat change (lane l-profile, owner ruling 3 Nov). A CLI engine keeps its own conversation between turns (a warm process, or a session id it
// resumes), and that conversation holds what earlier turns were told: in a chat only the person read, their private profile. When someone joins (or the chat's readers change any other way),
// the next turn must not continue that conversation. Before each session opens, the chat's audience (lib/audience.ts, the one rule memory uses) is compared with the one the last session of this
// chat, agent and person ran under; when it differs, the engine's session id is forgotten and the chat's idle warm processes are closed, so the turn starts a new session from the chat itself.
// A first sight only records the audience. Reading the audience never holds a turn up: when it cannot be read, the turn opens as before.
import { chatAudience } from "../../lib/audience.ts";
import type { Audience } from "../../lib/audience.ts";
import type { EngineSession, OpenSession } from "../../agent/src/turn-engine/types.ts";
import { forgetSessions, keepsSession } from "./cli-sessions.ts";
import type { Db } from "./projections.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;

const ready = new WeakSet<object>();
function ensure(db: Db): void {
  if (ready.has(db)) return;
  db.run("CREATE TABLE IF NOT EXISTS engine_audience_marks (thread_id TEXT NOT NULL, agent_id TEXT NOT NULL, person TEXT NOT NULL, mark TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (thread_id, agent_id, person))");
  ready.add(db);
}

/** An audience as one comparable string: the Space, or its people sorted. */
export const audienceMark = (a: Audience): string => (a.space ? "space" : JSON.stringify([...new Set(a.people)].sort()));

/** Record the audience a session of this chat, agent and person opens under. True when it differs from the last one recorded (a first sight is not a change). */
export function audienceChanged(db: Db, k: { threadId: string; agentId: string; person: string }, mark: string, now: number): boolean {
  ensure(db);
  const r = (db.all("SELECT mark FROM engine_audience_marks WHERE thread_id = ? AND agent_id = ? AND person = ?", k.threadId, k.agentId, k.person) as Array<{ mark: string }>)[0];
  if (r && r.mark === mark) return false;
  db.run("INSERT OR REPLACE INTO engine_audience_marks (thread_id, agent_id, person, mark, at) VALUES (?, ?, ?, ?, ?)", k.threadId, k.agentId, k.person, mark, now);
  return r !== undefined;
}

export interface AudienceResetDeps {
  db: Db;
  call: Call;
  now(): number;
  /** Close the chat's idle warm CLI processes (the pool's drop). Absent: only the session id is forgotten. */
  drop?(threadId: string): Promise<number>;
  log?(msg: string, attrs?: Record<string, unknown>): void;
}

export function withAudienceReset(open: OpenSession, d: AudienceResetDeps): OpenSession {
  return async (spec) => {
    if (spec.tools !== "none" && keepsSession(spec)) {
      try {
        const a = await chatAudience((cap, input) => d.call(cap, input, spec.asker), spec.threadId);
        if (audienceChanged(d.db, { threadId: spec.threadId, agentId: spec.agent.id, person: spec.asker }, audienceMark(a), d.now())) {
          forgetSessions(d.db, spec.threadId, spec.agent.id);
          await d.drop?.(spec.threadId).catch(() => 0);
          d.log?.("the people in this chat changed: the engine starts a new session", { threadId: spec.threadId, agentId: spec.agent.id });
        }
      } catch { /* the audience could not be read: the turn opens as it would have */ }
    }
    return open(spec) as Promise<EngineSession>;
  };
}
