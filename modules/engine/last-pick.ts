// The model a person last picked (owner rule, 4 Nov): a new chat starts on it, not on the Space key's default. It is remembered per person and per agent (an agent whose chats have their own pick keeps it),
// with the person's latest pick of any agent as the fallback, and it lives on the Space's server, so it follows the person to every device. An explicit pick in a chat (engine.set_model) updates it. A new
// chat gets it as its own pick, so the resolver honours it as any pick: when nothing can run it, the turn says so, and nothing runs in its place.
import type { Db } from "./projections.ts";

export interface Pick { model: string; provider: string | null; effort: string | null }
const ready = new WeakSet<object>();
const ANY = "*";

function ensure(db: Db): void {
  if (ready.has(db as object)) return;
  db.run("CREATE TABLE IF NOT EXISTS engine_last_pick (person TEXT NOT NULL, agent TEXT NOT NULL, model TEXT NOT NULL, provider TEXT, effort TEXT, at INTEGER NOT NULL, PRIMARY KEY (person, agent))");
  db.run("CREATE TABLE IF NOT EXISTS engine_pick_history (person TEXT NOT NULL, model TEXT NOT NULL, provider TEXT, at INTEGER NOT NULL, PRIMARY KEY (person, model))");
  ready.add(db as object);
}

/** How many distinct models a person's pick history keeps. */
export const HISTORY = 3;

/** A person picked a model for an agent in a chat. */
export function rememberPick(db: Db, person: string, agent: string, pick: Pick, now: number): void {
  ensure(db);
  db.run("INSERT OR REPLACE INTO engine_pick_history (person, model, provider, at) VALUES (?, ?, ?, ?)", person, pick.model, pick.provider, now);
  db.run("DELETE FROM engine_pick_history WHERE person = ? AND model NOT IN (SELECT model FROM engine_pick_history WHERE person = ? ORDER BY at DESC, rowid DESC LIMIT ?)", person, person, HISTORY);
  for (const a of [agent, ANY]) db.run("INSERT OR REPLACE INTO engine_last_pick (person, agent, model, provider, effort, at) VALUES (?, ?, ?, ?, ?, ?)", person, a, pick.model, pick.provider, pick.effort, now);
}

/** What a new chat of this agent starts on for this person: their last pick for the agent, else their last pick of any agent. */
export function recallPick(db: Db, person: string, agent: string): Pick | null {
  ensure(db);
  const rows = db.all("SELECT agent, model, provider, effort FROM engine_last_pick WHERE person = ? AND agent IN (?, ?)", person, agent, ANY) as Array<{ agent: string; model: string; provider: string | null; effort: string | null }>;
  const r = rows.find((x) => x.agent === agent) ?? rows.find((x) => x.agent === ANY);
  return r ? { model: r.model, provider: r.provider, effort: r.effort } : null;
}

/** The last few distinct models this person picked, newest first: when the newest fails, the fallback walks back through the rest. */
export function recentPicks(db: Db, person: string): string[] {
  ensure(db);
  return (db.all("SELECT model FROM engine_pick_history WHERE person = ? ORDER BY at DESC, rowid DESC LIMIT ?", person, HISTORY) as Array<{ model: string }>).map((r) => r.model);
}
