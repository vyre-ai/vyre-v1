// @reads /modules/events/migrations/0001_events.sql
// Events module state (spec 2.22, 3.10; ARCH 4.3, 7.10): outgoing webhooks, their delivery log, replay records and the `events.webhooks_out` consumer.
// The module reaches the event log and the network only through the two host ports (host/src/seams/events-ports.ts, P-H_05), which the host hands over through
// `hostSeams.setEventsHost` at boot (ruling 31). Handlers reach tables only through ctx.db; the consumer works on the kernel Tx.
//
// DECISION: webhooks carry only events anyone in the Space may see: vis `space`, label public or internal, payload not encrypted. Private, owner and participant events,
// Confidential and Restricted ones never leave through a webhook. `webhook.*` events are never delivered either, or a delivery would trigger the next one.
// DECISION: a webhook `filter` is an object of JSON pointers into the event payload: `{"/type": "contact", "/fields/stage": ["won", "lost"]}`; a value is matched exactly, a list
// means any of its values, and every pointer must match. A missing filter matches every event of the subscribed types.
// DECISION: delivery states. pending = queued, not yet tried. retrying = tried, will try again. delivered = a 2xx answer. failed = refused for good (a 4xx other than 408 and 429,
// a redirect, an address the egress policy refuses, a webhook switched off). gave_up = still failing after 24 hours of retries. Backoff doubles from 30 seconds to a cap of 6 hours.
import { readFileSync } from "node:fs";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import type { EventsHostSeam } from "../../host/src/seams/events-ports.ts";
import type { StoredEvent } from "../../kernel/src/log/types.ts";
import type { AsyncConsumer, Tx } from "../../kernel/src/store/projection.ts";
import { fail } from "../../host/src/routes/errors.ts";

/** The part of the host Ctx these handlers use. The full Ctx satisfies it. */
export type EventsCtx = Pick<Ctx, "space" | "principal" | "trace" | "now" | "db" | "emit" | "call" | "seal" | "schedule"> & { actingFor?: string | undefined };

type Code = Parameters<typeof fail>[0];
export function raise(ctx: Pick<EventsCtx, "trace">, code: Code, message?: string): never {
  throw fail(code, ctx.trace.traceId, message ? { message } : {});
}

// ---- host ports and the dispatcher (set at boot)

/** Starts a capability as the system (the host's consumer runner provides it); the consumer uses it to begin each delivery. */
export type Dispatch = (cap: string, input: unknown) => Promise<unknown>;
const runtime: { host: EventsHostSeam | null; dispatch: Dispatch | null } = { host: null, dispatch: null };
export function setEventsHost(h: EventsHostSeam | null): void { runtime.host = h; }
export function setEventsDispatch(d: Dispatch | null): void { runtime.dispatch = d; }
export function hostPorts(ctx: Pick<EventsCtx, "trace">): EventsHostSeam {
  if (!runtime.host) raise(ctx, "internal.unavailable", "Event reading and delivery are not set up on this server yet.");
  return runtime.host!;
}
export const hostIfSet = (): EventsHostSeam | null => runtime.host;

// ---- ids, paging

const HEX = "0123456789abcdef";
export function nid(prefix: string, bytes = 9): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const x of b) s += HEX[x >> 4]! + HEX[x & 15]!;
  return `${prefix}_${s}`;
}
export const PAGE_DEFAULT = 100;
export const PAGE_MAX = 500;
export function pageOf<T>(rows: T[], cursor: string | undefined, limit: number | undefined): { items: T[]; next?: string; total: number } {
  const start = cursor !== undefined && /^[0-9]+$/.test(cursor) ? Number(cursor) : 0;
  const size = Math.min(PAGE_MAX, Math.max(1, limit ?? PAGE_DEFAULT));
  const items = rows.slice(start, start + size);
  return { items, ...(start + size < rows.length ? { next: String(start + size) } : {}), total: rows.length };
}

// ---- rows

export type DeliveryState = "pending" | "retrying" | "delivered" | "failed" | "gave_up";
export interface WebhookRec {
  id: string; name: string; url: string; event_types: string; filter: string | null; active: number; secret: string; secret_hint: string; created_by: string;
  created_at: number; last_delivery_at: number | null; failure_streak: number; gave_up_streak: number; version: number; updated_at: number | null; deleted_at: number | null;
}
export interface DeliveryRec {
  id: string; webhook_id: string; event_id: string; event_type: string; kind: "event" | "test" | "replay"; replay_of: string | null; state: DeliveryState; attempts: number;
  http_status: number | null; last_error: string | null; at: number; first_at: number; next_attempt_at: number | null; duration_ms: number | null; body: string | null; trace_id: string | null;
}

export function webhookOut(w: WebhookRec) {
  return {
    id: w.id, name: w.name, url: w.url, eventTypes: JSON.parse(w.event_types) as string[],
    ...(w.filter !== null ? { filter: JSON.parse(w.filter) as unknown } : {}),
    active: w.active === 1, secretHint: w.secret_hint, createdBy: w.created_by, createdAt: w.created_at,
    ...(w.last_delivery_at !== null ? { lastDeliveryAt: w.last_delivery_at } : {}), failureStreak: w.failure_streak,
  };
}

export function deliveryOut(d: DeliveryRec) {
  return {
    id: d.id, webhookId: d.webhook_id, eventId: d.event_id, eventType: d.event_type, state: d.state, attempts: d.attempts,
    ...(d.http_status !== null ? { httpStatus: d.http_status } : {}), ...(d.last_error !== null ? { lastError: d.last_error } : {}), at: d.at,
    ...(d.next_attempt_at !== null ? { nextAttemptAt: d.next_attempt_at } : {}), ...(d.duration_ms !== null ? { durationMs: d.duration_ms } : {}),
  };
}

export function webhookById(ctx: Pick<EventsCtx, "db">, id: string): WebhookRec | undefined {
  return ctx.db.all(`SELECT * FROM events_webhook WHERE id = ? AND deleted_at IS NULL`, id)[0] as WebhookRec | undefined;
}
export function mustWebhook(ctx: EventsCtx, id: string): WebhookRec {
  return webhookById(ctx, id) ?? raise(ctx, "validation.not_found", "no such webhook");
}
export function deliveryById(ctx: Pick<EventsCtx, "db">, id: string): DeliveryRec | undefined {
  return ctx.db.all(`SELECT * FROM events_delivery WHERE id = ?`, id)[0] as DeliveryRec | undefined;
}

// ---- matching an event to a webhook

/** `*`, `noun.*` and exact names. */
export function typeMatches(patterns: readonly string[], type: string): boolean {
  return patterns.some((p) => p === "*" || (p.endsWith(".*") ? type.startsWith(p.slice(0, -1)) : p === type));
}

function pointerGet(value: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") return value;
  let cur: unknown = value;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function filterMatches(filter: unknown, payload: unknown): boolean {
  if (filter === null || filter === undefined) return true;
  if (typeof filter !== "object" || Array.isArray(filter)) return false;
  for (const [pointer, want] of Object.entries(filter as Record<string, unknown>)) {
    const got = pointerGet(payload, pointer);
    const ok = Array.isArray(want) ? want.some((w) => w === got) : want === got;
    if (!ok) return false;
  }
  return true;
}

/** An event may leave through a webhook only when anyone in the Space may see it (see the DECISION at the top). */
export const MAX_WEBHOOK_LABEL = 1;
export function mayLeave(e: Pick<StoredEvent, "type" | "vis" | "label" | "enc">): boolean {
  return e.vis === "space" && e.label <= MAX_WEBHOOK_LABEL && e.enc === 0 && !e.type.startsWith("webhook.");
}

// ---- retry schedule

export const FIRST_RETRY_MS = 30_000;
export const MAX_BACKOFF_MS = 6 * 3_600_000;
export const GIVE_UP_AFTER_MS = 24 * 3_600_000;
export const DISABLE_AFTER_GAVE_UP = 20;
/** Wait before attempt `n + 1` after attempt `n` failed (n starts at 1). */
export const backoffMs = (n: number): number => Math.min(MAX_BACKOFF_MS, FIRST_RETRY_MS * 2 ** Math.max(0, n - 1));

// ---- the consumer

const SEQ_KEY = "last_seq";
export const lastSeq = (ctx: Pick<EventsCtx, "db">): number => (ctx.db.all(`SELECT value FROM events_state WHERE key = ?`, SEQ_KEY)[0] as { value: number } | undefined)?.value ?? 0;

/** The module's tables, from the migration file, so the consumer can open on a database the migration has not reached yet. */
export const migrationSql = (): string => readFileSync(new URL("./migrations/0001_events.sql", import.meta.url), "utf8");

/**
 * Queue one pending delivery for every active webhook the event matches (at most one per webhook and event, so a repeated event after a crash queues nothing new),
 * then ask the dispatcher to start each. Idempotent: the cursor moves after this returns.
 */
export async function fanOut(tx: Tx, e: StoredEvent, dispatch: Dispatch | null, now: number): Promise<number> {
  tx.run(`INSERT OR REPLACE INTO events_state (key, value) VALUES (?, ?)`, SEQ_KEY, e.seq);
  if (!mayLeave(e)) return 0;
  const hooks = tx.all<WebhookRec>(`SELECT * FROM events_webhook WHERE active = 1 AND deleted_at IS NULL`);
  let payload: unknown;
  let queued = 0;
  const started: string[] = [];
  for (const w of hooks) {
    if (!typeMatches(JSON.parse(w.event_types) as string[], e.type)) continue;
    if (w.filter !== null) {
      payload ??= JSON.parse(new TextDecoder().decode(e.payload));
      if (!filterMatches(JSON.parse(w.filter), payload)) continue;
    }
    if (tx.get(`SELECT id FROM events_delivery WHERE webhook_id = ? AND event_id = ? AND kind = 'event'`, w.id, e.id)) continue;
    tx.run(
      `INSERT INTO events_delivery (id, webhook_id, event_id, event_type, kind, state, attempts, at, first_at, next_attempt_at, trace_id) VALUES (?, ?, ?, ?, 'event', 'pending', 0, ?, ?, ?, ?)`,
      nid("dlv"), w.id, e.id, e.type, now, now, now, e.trace_id,
    );
    queued++;
    started.push(w.id);
  }
  if (dispatch) {
    for (const webhookId of started) {
      try { await dispatch("webhooks.send_delivery", { webhookId, eventId: e.id, attempt: 1, idempotencyKey: `${webhookId}:${e.id}:1` }); } catch { /* the row stays pending; the next sweep or manual replay picks it up */ }
    }
  }
  return queued;
}

const everyEvent: Record<string, (tx: Tx, e: StoredEvent) => Promise<void>> = new Proxy({} as Record<string, (tx: Tx, e: StoredEvent) => Promise<void>>, {
  get: (_t, name) => (typeof name === "string" ? async (tx: Tx, e: StoredEvent) => { await fanOut(tx, e, runtime.dispatch, Date.now()); } : undefined),
});

export const webhooksOut: AsyncConsumer = {
  name: "events.webhooks_out",
  version: 1,
  mode: "async",
  rebuild: "replay",
  init(tx) { tx.exec(migrationSql()); },
  reset(tx) { tx.run(`DELETE FROM events_state`); },   // deliveries and webhooks are the module's own records, not derived from the log
  on: everyEvent,
  batch: 100,
};

/** Deliveries that have waited past their time and have no scheduled retry behind them: pending ones (the dispatcher was missing) and retrying ones. */
export function dueDeliveries(ctx: Pick<EventsCtx, "db">, now: number, limit = 100): DeliveryRec[] {
  return (ctx.db.all(`SELECT * FROM events_delivery WHERE next_attempt_at IS NOT NULL AND next_attempt_at <= ? ORDER BY next_attempt_at ASC LIMIT ?`, now, limit) as DeliveryRec[])
    .filter((d) => d.kind === "event" && (d.state === "pending" || d.state === "retrying"));
}

export const projections = [webhooksOut];
export const consumers = { "events.webhooks_out": webhooksOut };
export const inline = {};
export const codecs = {};
