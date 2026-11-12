// Hands a chat to memory when it is over (spec 2.15): memory.capture runs when a chat is closed and, once, when it has been quiet for IDLE_MS. It runs as a person in the chat, because a private chat can
// only be read as one of its people (a service that asked would be told the chat is not there); the person is the last one who wrote in it. What a chat may leave behind is memory's own business:
// capture reads the lead agent's captureMode (off keeps nothing, propose leaves every fact to accept, auto_low_risk merges the low-risk kinds).
import { engineHost } from "../runtime.ts";
import { ensure } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

export const IDLE_MS = 30 * 60_000;
const BATCH = 20;

export type CaptureCall = (cap: string, input: unknown, as?: string) => Promise<unknown>;
interface Event { at?: number; actor?: string; payload: Record<string, unknown> }
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A person wrote in a thread: it will be captured once it has been quiet, as that person. */
export function noteActivity(ctx: EngineCtx, event: Event): string[] {
  const author = event.payload["author"] as { kind?: string; id?: string } | undefined;
  const threadId = str(event.payload["threadId"]);
  if (threadId === "" || author?.kind !== "person" || !author.id) return [];
  ensure(ctx.db);
  ctx.db.run("INSERT INTO engine_capture_state (thread_id, person, last_at, captured_at) VALUES (?, ?, ?, NULL) ON CONFLICT(thread_id) DO UPDATE SET person = excluded.person, last_at = excluded.last_at", threadId, author.id, event.at ?? ctx.now());
  return [threadId];
}

async function captureOne(ctx: EngineCtx, call: CaptureCall, threadId: string, person: string, reason: "closed" | "idle"): Promise<boolean> {
  try {
    await call("memory.capture", { threadId, reason }, person);
    return true;
  } catch (e) {
    ctx.log.warn("memory capture failed for a chat", { threadId, reason, error: e instanceof Error ? e.message : String(e) });
    return false;
  } finally {
    // read or failed, it is not asked again until someone writes in the chat again
    ctx.db.run("UPDATE engine_capture_state SET captured_at = ? WHERE thread_id = ?", ctx.now(), threadId);
  }
}

/** A thread was closed. The person is whoever last wrote in it, else whoever closed it. */
export async function captureClosed(ctx: EngineCtx, event: Event, call: CaptureCall | null = engineHost()?.call ?? null): Promise<string[]> {
  const threadId = str(event.payload["threadId"]);
  if (threadId === "" || !call) return [];
  ensure(ctx.db);
  const known = (ctx.db.all("SELECT person FROM engine_capture_state WHERE thread_id = ?", threadId)[0] as { person?: string } | undefined)?.person;
  const person = known ?? (event.actor?.startsWith("usr_") ? event.actor : undefined);
  if (!person) return [];
  ctx.db.run("INSERT OR IGNORE INTO engine_capture_state (thread_id, person, last_at, captured_at) VALUES (?, ?, ?, NULL)", threadId, person, ctx.now());
  return (await captureOne(ctx, call, threadId, person, "closed")) ? [threadId] : [];
}

/** The chats that have been quiet for idleMs and have messages memory has not read. */
export async function captureIdle(ctx: EngineCtx, idleMs: number = IDLE_MS, call: CaptureCall | null = engineHost()?.call ?? null): Promise<string[]> {
  if (!call) return [];
  ensure(ctx.db);
  const due = ctx.db.all("SELECT thread_id, person FROM engine_capture_state WHERE last_at <= ? AND (captured_at IS NULL OR captured_at < last_at) ORDER BY last_at LIMIT ?", ctx.now() - idleMs, BATCH) as Array<{ thread_id: string; person: string }>;
  const done: string[] = [];
  for (const r of due) if (await captureOne(ctx, call, r.thread_id, r.person, "idle")) done.push(r.thread_id);
  return done;
}

export const captureConsumers = {
  "engine.memory_activity": { on: ["message.received"], run: (ctx: EngineCtx, event: Event): string[] => noteActivity(ctx, event) },
  "engine.memory_capture_closed": { on: ["thread.closed"], run: (ctx: EngineCtx, event: Event): Promise<string[]> => captureClosed(ctx, event) },
};

export const capturePeriodic = {
  "engine.memory_capture_idle": { everyMs: 60_000, run: (ctx: EngineCtx): Promise<string[]> => captureIdle(ctx) },
};
