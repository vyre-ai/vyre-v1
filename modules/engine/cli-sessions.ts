// What a chat keeps between engine sessions (lane l-sessions):
//   engine_cli_sessions   the CLI engine's own session id per chat, agent, person and engine (Claude Code `--resume <id>`, Codex `exec resume <id>`, Grok `--resume <id>`), written each time the
//                         engine names a new one and read when the chat's next session opens, so a daemon restart or a pool eviction resumes the engine's own context instead of starting over.
//                         The session files the CLI keeps live in the person's engine home (<scratch>/home, sandbox.ts), which outlives turns and restarts.
//   engine_compact_keep   "Keep this every time" of a chat: what every compaction of it keeps, the person's own and the engine's automatic ones.
//   engine_compactions    the latest compaction of a chat for one agent: how it was done (the engine's own, or Vyre's summary), what stands for the turns before it, and the context it left, for the meter.
// The tables are created here with CREATE TABLE IF NOT EXISTS, the way the other engine_* helper tables are (handlers/usage.ts), so no migration list changes. No value here is a secret.
import type { Db } from "./projections.ts";

const ready = new WeakSet<object>();
function ensure(db: Db): void {
  if (ready.has(db)) return;
  db.run("CREATE TABLE IF NOT EXISTS engine_cli_sessions (thread_id TEXT NOT NULL, agent_id TEXT NOT NULL, person TEXT NOT NULL, driver TEXT NOT NULL, session_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (thread_id, agent_id, person, driver))");
  db.run("CREATE TABLE IF NOT EXISTS engine_compact_keep (thread_id TEXT PRIMARY KEY, keep TEXT NOT NULL, by_principal TEXT NOT NULL, at INTEGER NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS engine_compactions (thread_id TEXT NOT NULL, agent_id TEXT NOT NULL, how TEXT NOT NULL, up_to_seq INTEGER NOT NULL, summary TEXT NOT NULL, keep TEXT NOT NULL, used INTEGER, win INTEGER, at INTEGER NOT NULL, PRIMARY KEY (thread_id, agent_id))");
  ready.add(db);
}

/** Whose engine session it is: one chat, one agent, the person it runs for, one engine. Two people in one chat never share an engine session (their access differs). */
export interface SessionKey { threadId: string; agentId: string; person: string; driver: string }

/** A session that belongs to no chat (an automation's AI step, a one-shot job) is not kept: nothing would resume it. */
export const keepsSession = (k: { threadId: string; tools?: "none" }): boolean => k.tools !== "none" && !k.threadId.startsWith("oneshot_");

export function resumeId(db: Db, k: SessionKey): string | null {
  ensure(db);
  const r = (db.all("SELECT session_id FROM engine_cli_sessions WHERE thread_id = ? AND agent_id = ? AND person = ? AND driver = ?", k.threadId, k.agentId, k.person, k.driver) as Array<{ session_id: string }>)[0];
  return r ? r.session_id : null;
}

/** Keep the engine's session id (null forgets it). */
export function saveResumeId(db: Db, k: SessionKey, sessionId: string | null, now: number): void {
  ensure(db);
  if (sessionId === null || sessionId === "") {
    db.run("DELETE FROM engine_cli_sessions WHERE thread_id = ? AND agent_id = ? AND person = ? AND driver = ?", k.threadId, k.agentId, k.person, k.driver);
    return;
  }
  db.run("INSERT OR REPLACE INTO engine_cli_sessions (thread_id, agent_id, person, driver, session_id, at) VALUES (?, ?, ?, ?, ?, ?)", k.threadId, k.agentId, k.person, k.driver, sessionId.slice(0, 200), now);
}

/** Forget every engine session of an agent in a chat (Vyre compacted it: the next turn starts a new one from the summary). Returns how many were forgotten. */
export function forgetSessions(db: Db, threadId: string, agentId: string): number {
  ensure(db);
  return db.run("DELETE FROM engine_cli_sessions WHERE thread_id = ? AND agent_id = ?", threadId, agentId).changes;
}

export const KEEP_MAX = 2_000;

/** "Keep this every time" of a chat, or "" when none is set. */
export function keepEvery(db: Db, threadId: string): string {
  ensure(db);
  const r = (db.all("SELECT keep FROM engine_compact_keep WHERE thread_id = ?", threadId) as Array<{ keep: string }>)[0];
  return r ? r.keep : "";
}

/** Set it; empty clears it. */
export function setKeepEvery(db: Db, threadId: string, keep: string, by: string, now: number): string {
  ensure(db);
  const k = keep.trim().slice(0, KEEP_MAX);
  if (k === "") db.run("DELETE FROM engine_compact_keep WHERE thread_id = ?", threadId);
  else db.run("INSERT OR REPLACE INTO engine_compact_keep (thread_id, keep, by_principal, at) VALUES (?, ?, ?, ?)", threadId, k, by, now);
  return k;
}

/** What one compaction keeps: the words asked for this time, then the chat's standing ones when they say something else. */
export function keepFor(now: string | undefined, every: string): string {
  const parts = [now?.trim() ?? "", every.trim()].filter((x) => x !== "");
  return [...new Set(parts)].join("; ").slice(0, KEEP_MAX);
}

/**
 * The latest compaction of a chat for one agent. `engine`: the engine compacted its own context (Claude Code), and nothing about the turns changes. `vyre`: Vyre wrote the summary and the engine
 * session was restarted from it; from then on what an engine is sent of the chat starts after `upToSeq`, with `summary` standing for the rest.
 */
export interface Compaction { threadId: string; agentId: string; how: "engine" | "vyre"; upToSeq: number; summary: string; keep: string; used: number | null; window: number | null; at: number }

export function lastCompaction(db: Db, threadId: string, agentId: string): Compaction | null {
  ensure(db);
  const r = (db.all("SELECT * FROM engine_compactions WHERE thread_id = ? AND agent_id = ?", threadId, agentId) as Array<Record<string, unknown>>)[0];
  if (!r) return null;
  const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    threadId, agentId, how: r["how"] === "engine" ? "engine" : "vyre", upToSeq: Number(r["up_to_seq"] ?? 0), summary: String(r["summary"] ?? ""), keep: String(r["keep"] ?? ""),
    used: n(r["used"]), window: n(r["win"]), at: Number(r["at"] ?? 0),
  };
}

export function saveCompaction(db: Db, c: Compaction): void {
  ensure(db);
  db.run(
    "INSERT OR REPLACE INTO engine_compactions (thread_id, agent_id, how, up_to_seq, summary, keep, used, win, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    c.threadId, c.agentId, c.how, Math.trunc(c.upToSeq), c.summary, c.keep, c.used === null ? null : Math.trunc(c.used), c.window === null ? null : Math.trunc(c.window), c.at,
  );
}
