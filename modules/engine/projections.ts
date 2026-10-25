// @reads /modules/engine/migrations/0001_init.sql
// Durable rows of the engine module: the SQL behind the turn engine's ports (messages, thread queue, thread lease, parked tool calls),
// plus the id minting and the period keys the handlers share. Every statement names an engine_* table, which is all ctx.db lets a module touch.
// The migration file is the one source of the schema: ensure() runs it statement by statement (all IF NOT EXISTS), so a handler call on a fresh database works.
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";
import type { TurnEngine } from "../../agent/src/turn-engine/engine.ts";
import { LEASE_TTL_MS } from "../../agent/src/turn-engine/lease.ts";
import type { LeaseRow, LeaseStore } from "../../agent/src/turn-engine/lease.ts";
import type { NewItem, QueueStore } from "../../agent/src/turn-engine/queue.ts";
import type { MessageStore, WaitRow, WaitStore } from "../../agent/src/turn-engine/stores.ts";
import type { Author, QueueItem, QueueKind, QueueState, StoredMessage } from "../../agent/src/turn-engine/types.ts";
import type { RouteMention } from "../../lib/route.ts";

/** What the module needs of ctx.db (the host's ScopedDb has this shape). */
export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

type ErrorCode = Parameters<typeof fail>[0];

/** The part of the host Ctx these handlers read. A test passes a small object; the host passes the full Ctx. */
export interface EngineCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string | undefined;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: `${string}.${string}`, subject: string, payload: unknown): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  authorize(action: { perm: string | null; level: "view" | "use" | "edit" | "manage" }, resource: { type: string; id: string | null }): { effect: "allow" | "deny" | "hold" };
  log: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

/** Throw the catalogue error for this call. */
export function raise(ctx: Pick<EngineCtx, "trace">, code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}

/** Who did it: the person an agent acts for, else the caller. */
export const actorOf = (ctx: Pick<EngineCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;

// The engine that runs on this host. The host binds it at boot (impl.ts); handlers reach it through boundEngine().
let bound: TurnEngine | null = null;
export function bindEngine(engine: TurnEngine | null): void { bound = engine; }
export function boundEngine(ctx: Pick<EngineCtx, "trace">): TurnEngine {
  if (!bound) raise(ctx, "internal.unavailable", "The engine is not running on this host.");
  return bound;
}

const SCHEMA = readFileSync(new URL("./migrations/0001_init.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);

const ready = new WeakSet<object>();

/** Make sure the engine tables exist. One cheap probe per handle; the CREATE ... IF NOT EXISTS statements run only when it fails (a host that ran the migration pays nothing). */
export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try {
    db.all("SELECT note_text FROM engine_incident_notes WHERE incident_id = ?", "probe");
  } catch {
    for (const stmt of SCHEMA) db.run(stmt);
  }
  ready.add(db);
}

type Row = Record<string, unknown>;
const rows = (db: Db, sql: string, ...args: unknown[]): Row[] => db.all(sql, ...args) as Row[];
const str = (v: unknown): string => String(v ?? "");
const num = (v: unknown): number => Number(v ?? 0);
const orNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

// ---- ids

/** Contract ids are `<prefix>_<lowercase alphanumerics>`, trace ids are 32 hex. The engine asks for `m` (message), `t` (turn) and `tr` (trace). */
export function mintEngineId(prefix: string, now: number = Date.now()): string {
  const compact = mintUuid(now).replaceAll("-", "");
  if (prefix === "tr") return compact;
  const map: Record<string, string> = { m: "msg", t: "trn", q: "qid" };
  return `${map[prefix] ?? prefix}_${compact}`;
}

export const mintId = (prefix: string, now: number = Date.now()): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;

// ---- periods (UTC)

export const dayKey = (at: number): string => new Date(at).toISOString().slice(0, 10);
export const monthKey = (at: number): string => new Date(at).toISOString().slice(0, 7);
export const dayStart = (at: number): number => Date.parse(`${dayKey(at)}T00:00:00.000Z`);
export const monthStart = (at: number): number => Date.parse(`${monthKey(at)}-01T00:00:00.000Z`);

// ---- messages

function messageOf(r: Row): StoredMessage {
  return {
    id: str(r["id"]), threadId: str(r["thread_id"]), threadSeq: num(r["thread_seq"]),
    author: { kind: str(r["author_kind"]) === "agent" ? "agent" : "person", id: str(r["author_id"]) } satisfies Author,
    mentions: JSON.parse(str(r["mentions"])) as RouteMention[], depth: num(r["depth"]), body: str(r["body"]),
  };
}

// The id the next appended message must carry. The chat bridge sets it around engine.receive so a person's message is stored under the id chat gave it: one id for one message in both tables.
let forcedId: string | null = null;
export function withMessageId<T>(id: string, fn: () => T): T {
  forcedId = id;
  try { return fn(); } finally { forcedId = null; }
}

export function sqlMessages(db: Db, now: () => number = Date.now): MessageStore {
  ensure(db);
  return {
    append(given) {
      const msg = forcedId === null ? given : { ...given, id: forcedId };
      forcedId = null;
      // The sequence is taken in the same statement as the insert; two hosts racing for one number lose on the unique index and retry.
      for (let attempt = 0; ; attempt++) {
        try {
          db.run(
            `INSERT INTO engine_messages (id, thread_id, thread_seq, author_kind, author_id, mentions, depth, body, at)
             VALUES (?, ?, (SELECT COALESCE(MAX(thread_seq), 0) + 1 FROM engine_messages WHERE thread_id = ?), ?, ?, ?, ?, ?, ?)`,
            msg.id, msg.threadId, msg.threadId, msg.author.kind, msg.author.id, JSON.stringify(msg.mentions), msg.depth, msg.body, now(),
          );
          break;
        } catch (e) {
          if (attempt >= 4 || !/unique|constraint/i.test(e instanceof Error ? e.message : "")) throw e;
        }
      }
      const r = rows(db, "SELECT * FROM engine_messages WHERE id = ?", msg.id)[0];
      if (!r) throw new Error("message was not stored");
      return messageOf(r);
    },
    get(id) {
      const r = rows(db, "SELECT * FROM engine_messages WHERE id = ?", id)[0];
      return r ? messageOf(r) : null;
    },
    recent(threadId, limit) {
      return rows(db, "SELECT * FROM engine_messages WHERE thread_id = ? ORDER BY thread_seq DESC LIMIT ?", threadId, limit).map(messageOf).reverse();
    },
  };
}

// ---- thread queue

function itemOf(r: Row): QueueItem {
  return {
    threadId: str(r["thread_id"]), qseq: num(r["qseq"]), kind: str(r["kind"]) as QueueKind, messageId: orNull(r["message_id"]), agentId: str(r["agent_id"]),
    from: str(r["from_principal"]), priority: num(r["priority"]), state: str(r["state"]) as QueueState, enqueuedAt: num(r["enqueued_at"]),
    routine: num(r["routine"]) === 1, steer: num(r["steer"]) === 1,
  };
}

const ORDER = "ORDER BY priority DESC, qseq ASC";

export function sqlQueue(db: Db): QueueStore {
  ensure(db);
  const queued = (threadId: string): QueueItem[] => rows(db, `SELECT * FROM engine_thread_queue WHERE thread_id = ? AND state = 'queued' ${ORDER}`, threadId).map(itemOf);
  return {
    enqueue(item: NewItem) {
      for (let attempt = 0; ; attempt++) {
        const next = num(rows(db, "SELECT COALESCE(MAX(qseq), 0) + 1 AS n FROM engine_thread_queue WHERE thread_id = ?", item.threadId)[0]?.["n"]);
        try {
          db.run(
            `INSERT INTO engine_thread_queue (thread_id, qseq, kind, message_id, agent_id, from_principal, priority, state, enqueued_at, routine, steer)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
            item.threadId, next, item.kind, item.messageId, item.agentId, item.from, item.priority, item.enqueuedAt, item.routine ? 1 : 0, item.steer ? 1 : 0,
          );
          return { ...item, qseq: next, state: "queued" };
        } catch (e) {
          if (attempt >= 4 || !/unique|constraint/i.test(e instanceof Error ? e.message : "")) throw e;
        }
      }
    },
    peek: (threadId) => queued(threadId)[0] ?? null,
    dequeue(threadId) {
      const next = queued(threadId)[0];
      if (!next) return null;
      db.run("UPDATE engine_thread_queue SET state = 'running' WHERE thread_id = ? AND qseq = ?", threadId, next.qseq);
      return { ...next, state: "running" };
    },
    steerable: (threadId, agentId) => queued(threadId).filter((r) => r.steer && r.kind === "message" && r.agentId === agentId).sort((a, b) => a.qseq - b.qseq),
    setState(threadId, qseq, state) {
      db.run("UPDATE engine_thread_queue SET state = ? WHERE thread_id = ? AND qseq = ?", state, threadId, qseq);
    },
    cancelQueued(threadId, agentId) {
      const out = queued(threadId).filter((r) => agentId === undefined || r.agentId === agentId);
      for (const r of out) db.run("UPDATE engine_thread_queue SET state = 'cancelled' WHERE thread_id = ? AND qseq = ?", threadId, r.qseq);
      return out.map((r) => ({ ...r, state: "cancelled" as const }));
    },
    running: (threadId) => rows(db, `SELECT * FROM engine_thread_queue WHERE thread_id = ? AND state = 'running' ${ORDER}`, threadId).map(itemOf),
    list: (threadId) => rows(db, "SELECT * FROM engine_thread_queue WHERE thread_id = ? ORDER BY qseq ASC", threadId).map(itemOf),
  };
}

// ---- thread lease

function leaseOf(r: Row): LeaseRow {
  return { threadId: str(r["thread_id"]), holder: str(r["holder"]), expiresAt: num(r["expires_at"]), turnId: orNull(r["turn_id"]) };
}

export function sqlLeases(db: Db, ttlMs: number = LEASE_TTL_MS): LeaseStore {
  ensure(db);
  const read = (threadId: string): LeaseRow | null => {
    const r = rows(db, "SELECT * FROM engine_thread_lease WHERE thread_id = ?", threadId)[0];
    return r ? leaseOf(r) : null;
  };
  return {
    acquire(threadId, holder, now, turnId = null) {
      // One compare-and-set statement: take the row if it is free, expired, or already ours. A live lease of another holder is left alone.
      db.run(
        `INSERT INTO engine_thread_lease (thread_id, holder, expires_at, turn_id) VALUES (?, ?, ?, ?)
         ON CONFLICT (thread_id) DO UPDATE SET
           holder = excluded.holder,
           expires_at = excluded.expires_at,
           turn_id = CASE WHEN engine_thread_lease.expires_at > ? THEN COALESCE(excluded.turn_id, engine_thread_lease.turn_id) ELSE excluded.turn_id END
         WHERE engine_thread_lease.holder = excluded.holder OR engine_thread_lease.expires_at <= ?`,
        threadId, holder, now + ttlMs, turnId, now, now,
      );
      const cur = read(threadId);
      return cur && cur.holder === holder ? cur : null;
    },
    renew: (threadId, holder, now) => db.run("UPDATE engine_thread_lease SET expires_at = ? WHERE thread_id = ? AND holder = ? AND expires_at > ?", now + ttlMs, threadId, holder, now).changes > 0,
    setTurn(threadId, holder, turnId) {
      db.run("UPDATE engine_thread_lease SET turn_id = ? WHERE thread_id = ? AND holder = ?", turnId, threadId, holder);
    },
    release: (threadId, holder) => db.run("DELETE FROM engine_thread_lease WHERE thread_id = ? AND holder = ?", threadId, holder).changes > 0,
    get(threadId, now) {
      const cur = read(threadId);
      return cur && cur.expiresAt > now ? cur : null;
    },
  };
}

// ---- parked tool calls

function waitOf(r: Row): WaitRow {
  const res = orNull(r["resolution"]);
  return {
    taskId: str(r["task_id"]), threadId: str(r["thread_id"]), turnId: str(r["turn_id"]), agentId: str(r["agent_id"]), callId: str(r["call_id"]), toolName: str(r["tool_name"]),
    asker: str(r["asker"]), runId: orNull(r["run_id"]), at: num(r["at"]), resolution: res === null ? null : (JSON.parse(res) as WaitRow["resolution"]),
    wakeQseq: r["wake_qseq"] === null || r["wake_qseq"] === undefined ? null : num(r["wake_qseq"]),
  };
}

export function sqlWaits(db: Db): WaitStore {
  ensure(db);
  return {
    put(w) {
      db.run(
        `INSERT OR REPLACE INTO engine_waits (task_id, thread_id, turn_id, agent_id, call_id, tool_name, asker, run_id, at, resolution, wake_qseq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        w.taskId, w.threadId, w.turnId, w.agentId, w.callId, w.toolName, w.asker, w.runId, w.at, w.resolution === null ? null : JSON.stringify(w.resolution), w.wakeQseq,
      );
    },
    get(taskId) {
      const r = rows(db, "SELECT * FROM engine_waits WHERE task_id = ?", taskId)[0];
      return r ? waitOf(r) : null;
    },
    resolve: (taskId, resolution, wakeQseq) =>
      db.run("UPDATE engine_waits SET resolution = ?, wake_qseq = ? WHERE task_id = ? AND resolution IS NULL", JSON.stringify(resolution), wakeQseq, taskId).changes > 0,
    forWake(threadId, qseq) {
      const r = rows(db, "SELECT * FROM engine_waits WHERE thread_id = ? AND wake_qseq = ?", threadId, qseq)[0];
      return r ? waitOf(r) : null;
    },
    remove(taskId) {
      db.run("DELETE FROM engine_waits WHERE task_id = ?", taskId);
    },
    open: (threadId) => rows(db, "SELECT * FROM engine_waits WHERE thread_id = ? ORDER BY at ASC", threadId).map(waitOf),
  };
}
