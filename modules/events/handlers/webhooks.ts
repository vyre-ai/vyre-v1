// @reads /generated/registry.json
// Capability handlers of the events module (16): event log reads (events.list, get, since, types, replay) and outgoing webhooks (webhooks.*).
// Reading the log and sending a request both go through the host ports (see projections.ts). The signing secret is shown once, kept sealed (ctx.seal), opened only to sign.
import { readFileSync } from "node:fs";
import type { EventRow } from "../../../host/src/seams/events-ports.ts";
import { HostError } from "../../../host/src/routes/errors.ts";
import { isPrivateHost } from "../../../host/src/seams/events-ports.ts";
import {
  DISABLE_AFTER_GAVE_UP, GIVE_UP_AFTER_MS, backoffMs, deliveryById, deliveryOut, hostIfSet, hostPorts, lastSeq, mustWebhook, nid, pageOf, raise, webhookOut,
} from "../projections.ts";
import type { DeliveryRec, DeliveryState, EventsCtx, WebhookRec } from "../projections.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();
const SEAL_SCOPE = "events.webhook";
type Page = { cursor?: string; limit?: number };

// ---------------------------------------------------------------- event reads

/** Mirror of manifests/_common.ts RESOURCE_TYPES (the manifest is frozen, ruling 9): an event subject outside the list is left off the row. */
const RESOURCE_TYPES = new Set([
  "space", "record_type", "record", "project", "folder", "file", "channel", "thread", "inbox", "mailbox", "vault_folder", "vault_item", "automation_group", "automation", "agent",
  "connector", "connection", "site", "form", "campaign", "kit", "terminal", "computer", "task", "run", "number", "domain", "calendar",
]);

const caller = (ctx: EventsCtx) => ({ principal: ctx.principal.id, ...(ctx.actingFor ? { actingFor: ctx.actingFor } : {}) });

function eventOut(r: EventRow) {
  const { sealed, subject, ...rest } = r;
  return { ...rest, payload: sealed ? { sealed: true } : r.payload, ...(subject && RESOURCE_TYPES.has(subject.type) ? { subject } : {}) };
}

const cursorSeq = (c: string | undefined): number => (c !== undefined && /^[0-9]+$/.test(c) ? Number(c) : 0);

export async function eventsList(ctx: EventsCtx, input: {
  types?: string[]; subject?: { type: string; id: string }; actor?: string; runId?: string; traceId?: string; from?: number; to?: number;
} & Page) {
  const page = await hostPorts(ctx).events.list(caller(ctx), {
    ...(input.types ? { types: input.types } : {}), ...(input.subject ? { subject: input.subject } : {}), ...(input.actor !== undefined ? { actor: input.actor } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}), ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
    ...(input.from !== undefined ? { fromAt: input.from } : {}), ...(input.to !== undefined ? { toAt: input.to } : {}),
    after: cursorSeq(input.cursor), ...(input.limit !== undefined ? { limit: input.limit } : {}),
  });
  return { events: page.events.map(eventOut), ...(page.more ? { next: String(page.next) } : {}) };
}

export async function eventsGet(ctx: EventsCtx, input: { eventId: string }) {
  const row = await hostPorts(ctx).events.get(caller(ctx), input.eventId);
  if (!row) raise(ctx, "validation.not_found", "no such event");
  return { event: eventOut(row!) };
}

export async function eventsSince(ctx: EventsCtx, input: { after: number; types?: string[]; limit?: number }) {
  const page = await hostPorts(ctx).events.since(caller(ctx), input.after, { ...(input.types ? { types: input.types } : {}), ...(input.limit !== undefined ? { limit: input.limit } : {}) });
  return { events: page.events.map(eventOut), next: page.next, head: page.head };
}

interface RegEvent { name: string; sv: number; summary: string; payload: unknown; trigger?: unknown; notify?: string }
let catalogue: RegEvent[] | null = null;
function loadCatalogue(): RegEvent[] {
  if (!catalogue) catalogue = (JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { events: RegEvent[] }).events;
  return catalogue;
}

export async function eventsTypes(_ctx: EventsCtx, input: { prefix?: string }) {
  const prefix = input.prefix ?? "";
  const types = loadCatalogue().filter((e) => e.name.startsWith(prefix)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e) => ({ name: e.name, sv: e.sv, summary: e.summary, payload: e.payload, trigger: e.trigger !== undefined && e.trigger !== null, ...(e.notify ? { notify: e.notify } : {}) }));
  return { types };
}

export const REPLAY_MAX_EVENTS = 20_000;

/**
 * The replay entry (spec 2.22, ARCH Replay): resolve the events the caller may read for a trace, a Run, a conflict or a seq range, then start a Run of kind `replay`
 * that names them. Running them against a copy of the Space, with outward effects recorded and not executed, is the replay engine's job; this call fixes the scope and records it.
 */
export async function eventsReplay(ctx: EventsCtx, input: { traceId?: string; runId?: string; conflictId?: string; fromSeq?: number; toSeq?: number; withClearance?: boolean }) {
  if (input.traceId === undefined && input.runId === undefined && input.conflictId === undefined && input.fromSeq === undefined && input.toSeq === undefined) {
    raise(ctx, "validation.bad_input", "Name a trace, a Run, a conflict or a range of events to replay.");
  }
  if (input.fromSeq !== undefined && input.toSeq !== undefined && input.toSeq < input.fromSeq) raise(ctx, "validation.bad_input", "The range ends before it starts.");
  const port = hostPorts(ctx).events;
  let after = Math.max(0, (input.fromSeq ?? 1) - 1), count = 0, first: number | null = null, last: number | null = null;
  for (;;) {
    const page = await port.list(caller(ctx), {
      after, limit: 1000, ...(input.traceId !== undefined ? { traceId: input.traceId } : {}), ...(input.runId !== undefined ? { runId: input.runId } : {}),
      ...(input.conflictId !== undefined ? { subject: { type: "conflict", id: input.conflictId } } : {}),
    });
    let pastEnd = false;
    for (const e of page.events) {
      if (input.toSeq !== undefined && e.seq > input.toSeq) { pastEnd = true; break; }
      count++; first ??= e.seq; last = e.seq;
    }
    if (count > REPLAY_MAX_EVENTS) raise(ctx, "validation.too_large", "That is too many events to replay at once. Narrow the range.");
    if (pastEnd || !page.more) break;
    after = page.next;
  }
  if (count === 0) raise(ctx, "validation.not_found", "There are no events you can read in that scope.");
  const selector = JSON.stringify({ traceId: input.traceId, runId: input.runId, conflictId: input.conflictId, fromSeq: input.fromSeq, toSeq: input.toSeq });
  const key = `replay:${input.traceId ?? ""}:${input.runId ?? ""}:${input.conflictId ?? ""}:${first}:${last}:${count}`;
  const started = (await ctx.call("runs.start", {
    kind: "replay", name: `Replay of ${count} event${count === 1 ? "" : "s"}`, owner: ctx.principal.id, subject: { type: "space", id: ctx.space }, idempotencyKey: key,
  }, { idempotencyKey: key })) as { runId: string };
  ctx.db.run(
    `INSERT OR REPLACE INTO events_replay (run_id, selector, from_seq, to_seq, event_count, with_clearance, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    started.runId, selector, first, last, count, input.withClearance ? 1 : 0, ctx.principal.id, ctx.now(),
  );
  return { runId: started.runId };
}

// ---------------------------------------------------------------- webhook definitions

const TYPE_PATTERN = /^(\*|[a-z][a-z0-9_]*(\.[a-z0-9_]+)*(\.\*)?)$/;

function checkUrl(ctx: EventsCtx, raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { return raise(ctx, "validation.bad_input", "That is not a web address."); }
  if (u.protocol !== "https:") raise(ctx, "validation.bad_input", "A webhook address starts with https://.");
  if (u.username || u.password) raise(ctx, "validation.bad_input", "Leave the user name and password out of the address.");
  if (isPrivateHost(u.hostname)) raise(ctx, "validation.bad_input", "A webhook cannot point at a private or local address.");
  return u.toString();
}

function checkTypes(ctx: EventsCtx, types: string[]): string[] {
  const out = [...new Set(types.map((t) => t.trim()))];
  if (out.length === 0) raise(ctx, "validation.bad_input", "Pick at least one event type.");
  for (const t of out) if (!TYPE_PATTERN.test(t)) raise(ctx, "validation.bad_input", `"${t}" is not an event type or a pattern like record.*.`);
  return out;
}

function checkFilter(ctx: EventsCtx, f: unknown): string | null {
  if (f === null || f === undefined) return null;
  if (typeof f !== "object" || Array.isArray(f)) return raise(ctx, "validation.bad_input", "A filter is an object of payload pointers and values.");
  const prim = (v: unknown): boolean => v === null || ["string", "number", "boolean"].includes(typeof v);
  for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
    if (!k.startsWith("/")) raise(ctx, "validation.bad_input", `Filter key "${k}" must be a payload pointer such as /type.`);
    if (!(prim(v) || (Array.isArray(v) && v.every(prim)))) raise(ctx, "validation.bad_input", `Filter value for "${k}" must be a value or a list of values.`);
  }
  return Object.keys(f as object).length === 0 ? null : JSON.stringify(f);
}

function newSecret(): { value: string; hint: string } {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(24));
  const value = `whsec_${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
  return { value, hint: value.slice(-4) };
}
const sealSecret = (ctx: EventsCtx, value: string): string => JSON.stringify(ctx.seal.seal(enc.encode(value), SEAL_SCOPE));
const openSecret = (ctx: EventsCtx, sealed: string): string => dec.decode(ctx.seal.unseal(JSON.parse(sealed)));

export async function webhooksCreate(ctx: EventsCtx, input: { name: string; url: string; eventTypes: string[]; filter?: unknown }) {
  const name = input.name.trim();
  if (!name) raise(ctx, "validation.bad_input", "Give the webhook a name.");
  const url = checkUrl(ctx, input.url), types = checkTypes(ctx, input.eventTypes), filter = checkFilter(ctx, input.filter);
  const secret = newSecret(), id = nid("whk"), now = ctx.now();
  ctx.db.run(
    `INSERT INTO events_webhook (id, name, url, event_types, filter, active, secret, secret_hint, created_by, created_at, last_delivery_at, failure_streak, gave_up_streak, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL, 0, 0, 0, ?, NULL)`,
    id, name, url, JSON.stringify(types), filter, sealSecret(ctx, secret.value), secret.hint, ctx.principal.id, now, now,
  );
  ctx.emit("webhook.created", id, { webhookId: id, name, eventTypes: types });
  return { webhook: webhookOut(mustWebhook(ctx, id)), secret: secret.value };
}

export async function webhooksList(ctx: EventsCtx, input: Page) {
  const rows = ctx.db.all(`SELECT * FROM events_webhook WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC`) as WebhookRec[];
  const p = pageOf(rows, input.cursor, input.limit);
  return { webhooks: p.items.map(webhookOut), ...(p.next ? { next: p.next } : {}), total: p.total };
}

export async function webhooksGet(ctx: EventsCtx, input: { webhookId: string }) {
  return { webhook: webhookOut(mustWebhook(ctx, input.webhookId)) };
}

export async function webhooksUpdate(ctx: EventsCtx, input: { webhookId: string; name?: string; url?: string; eventTypes?: string[]; filter?: unknown; active?: boolean }) {
  const w = mustWebhook(ctx, input.webhookId);
  const sets: string[] = [], args: unknown[] = [], fields: string[] = [];
  const set = (field: string, col: string, v: unknown): void => { sets.push(`${col} = ?`); args.push(v); fields.push(field); };
  if (input.name !== undefined) { const n = input.name.trim(); if (!n) raise(ctx, "validation.bad_input", "Give the webhook a name."); if (n !== w.name) set("name", "name", n); }
  if (input.url !== undefined) { const u = checkUrl(ctx, input.url); if (u !== w.url) set("url", "url", u); }
  if (input.eventTypes !== undefined) { const t = JSON.stringify(checkTypes(ctx, input.eventTypes)); if (t !== w.event_types) set("eventTypes", "event_types", t); }
  if ("filter" in input && input.filter !== undefined) { const f = checkFilter(ctx, input.filter); if (f !== w.filter) set("filter", "filter", f); }
  if (input.active !== undefined && input.active !== (w.active === 1)) {
    set("active", "active", input.active ? 1 : 0);
    if (input.active) { sets.push("gave_up_streak = ?", "failure_streak = ?"); args.push(0, 0); }   // switching it back on starts clean
  }
  if (sets.length > 0) {
    sets.push("version = ?", "updated_at = ?"); args.push(w.version + 1, ctx.now());
    ctx.db.run(`UPDATE events_webhook SET ${sets.join(", ")} WHERE id = ?`, ...args, w.id);
    ctx.emit("webhook.updated", w.id, { webhookId: w.id, fields });
  }
  return { webhook: webhookOut(mustWebhook(ctx, w.id)) };
}

export async function webhooksDelete(ctx: EventsCtx, input: { webhookId: string }) {
  const w = mustWebhook(ctx, input.webhookId);
  ctx.db.run(`UPDATE events_webhook SET deleted_at = ?, active = 0, version = ?, updated_at = ? WHERE id = ?`, ctx.now(), w.version + 1, ctx.now(), w.id);
  // pending deliveries are dropped; the log of what was delivered or failed stays for the audit trail
  ctx.db.run(`DELETE FROM events_delivery WHERE webhook_id = ? AND state = ?`, w.id, "pending");
  ctx.db.run(`DELETE FROM events_delivery WHERE webhook_id = ? AND state = ?`, w.id, "retrying");
  ctx.emit("webhook.deleted", w.id, { webhookId: w.id });
  return { deleted: true };
}

export async function webhooksRotateSecret(ctx: EventsCtx, input: { webhookId: string }) {
  const w = mustWebhook(ctx, input.webhookId);
  const secret = newSecret();
  ctx.db.run(`UPDATE events_webhook SET secret = ?, secret_hint = ?, version = ?, updated_at = ? WHERE id = ?`, sealSecret(ctx, secret.value), secret.hint, w.version + 1, ctx.now(), w.id);
  ctx.emit("webhook.secret_rotated", w.id, { webhookId: w.id, by: ctx.principal.id });
  return { secret: secret.value, webhook: webhookOut(mustWebhook(ctx, w.id)) };
}

export async function webhooksDeliveries(ctx: EventsCtx, input: { webhookId: string; states?: DeliveryState[] } & Page) {
  const w = mustWebhook(ctx, input.webhookId);
  let rows = ctx.db.all(`SELECT * FROM events_delivery WHERE webhook_id = ? ORDER BY at DESC, id DESC`, w.id) as DeliveryRec[];
  if (input.states && input.states.length > 0) rows = rows.filter((d) => input.states!.includes(d.state));
  const p = pageOf(rows, input.cursor, input.limit);
  return { deliveries: p.items.map(deliveryOut), ...(p.next ? { next: p.next } : {}), total: p.total };
}

// ---------------------------------------------------------------- delivery

/** The JSON that is signed and sent for one event. Field order is fixed so a replay of the stored text and a fresh render agree. */
export function deliveryBody(e: EventRow, webhookId: string): string {
  return JSON.stringify({
    id: e.id, type: e.type, sv: e.sv, seq: e.seq, at: e.at, traceId: e.traceId, actor: e.actor,
    ...(e.onBehalf !== undefined ? { onBehalf: e.onBehalf } : {}), ...(e.runId !== undefined ? { runId: e.runId } : {}), ...(e.subject ? { subject: e.subject } : {}),
    payload: e.sealed ? { sealed: true } : e.payload, webhookId,
  });
}

const RETRYABLE_STATUS = (s: number): boolean => s === 408 || s === 429 || s >= 500;

function saveDelivery(ctx: EventsCtx, d: DeliveryRec): void {
  ctx.db.run(
    `UPDATE events_delivery SET state = ?, attempts = ?, http_status = ?, last_error = ?, at = ?, next_attempt_at = ?, duration_ms = ?, body = ?, trace_id = ? WHERE id = ?`,
    d.state, d.attempts, d.http_status, d.last_error, d.at, d.next_attempt_at, d.duration_ms, d.body, d.trace_id, d.id,
  );
}

function newDelivery(ctx: EventsCtx, w: WebhookRec, o: { eventId: string; eventType: string; kind: DeliveryRec["kind"]; body: string | null; replayOf?: string }): DeliveryRec {
  const now = ctx.now();
  const d: DeliveryRec = {
    id: nid("dlv"), webhook_id: w.id, event_id: o.eventId, event_type: o.eventType, kind: o.kind, replay_of: o.replayOf ?? null, state: "pending", attempts: 0,
    http_status: null, last_error: null, at: now, first_at: now, next_attempt_at: now, duration_ms: null, body: o.body, trace_id: ctx.trace.traceId,
  };
  ctx.db.run(
    `INSERT INTO events_delivery (id, webhook_id, event_id, event_type, kind, replay_of, state, attempts, http_status, last_error, at, first_at, next_attempt_at, duration_ms, body, trace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.id, d.webhook_id, d.event_id, d.event_type, d.kind, d.replay_of, d.state, d.attempts, d.http_status, d.last_error, d.at, d.first_at, d.next_attempt_at, d.duration_ms, d.body, d.trace_id,
  );
  return d;
}

/** One attempt at one delivery: sign and send through the host port, record the outcome, schedule the next try or end it. `retry` is false for a test or a replay (one attempt, you read the answer). */
async function attempt(ctx: EventsCtx, w: WebhookRec, d: DeliveryRec, retry: boolean): Promise<DeliveryRec> {
  const now = ctx.now();
  const attempts = d.attempts + 1;
  let status: number | undefined, error: string | undefined, ok = false, retryable = false, durationMs = 0;
  if (w.active !== 1) { error = "The webhook is switched off."; }
  else {
    try {
      const r = await hostPorts(ctx).webhooks.post({
        url: w.url, body: d.body ?? "{}", secret: openSecret(ctx, w.secret), eventId: d.event_id, eventType: d.event_type, traceId: ctx.trace.traceId,
      });
      status = r.status; ok = r.ok; durationMs = r.durationMs;
      if (!ok) { error = r.error ?? `The endpoint answered ${r.status}.`; retryable = r.status === undefined || RETRYABLE_STATUS(r.status); }
    } catch (e) {
      // an address the egress policy refuses, or a body over the cap: no point trying again until someone changes it
      if (e instanceof HostError) error = e.error.message; else throw e;
    }
  }
  let state: DeliveryState, nextAt: number | null = null, willRetry = false;
  if (ok) state = "delivered";
  else if (!retryable || !retry) state = "failed";
  else {
    const wait = backoffMs(attempts);
    if (now - d.first_at + wait <= GIVE_UP_AFTER_MS) { state = "retrying"; nextAt = now + wait; willRetry = true; }
    else state = "gave_up";
  }
  const next: DeliveryRec = { ...d, state, attempts, http_status: status ?? null, last_error: ok ? null : error ?? null, at: now, next_attempt_at: nextAt, duration_ms: durationMs };
  saveDelivery(ctx, next);

  // the webhook's own record
  if (ok) {
    ctx.db.run(`UPDATE events_webhook SET last_delivery_at = ?, failure_streak = 0, gave_up_streak = 0 WHERE id = ?`, now, w.id);
    ctx.emit("webhook.delivered", w.id, { deliveryId: d.id, webhookId: w.id, eventId: d.event_id, httpStatus: status ?? 0, attempts });
  } else {
    const gaveUp = state === "gave_up" ? w.gave_up_streak + 1 : w.gave_up_streak;
    ctx.db.run(`UPDATE events_webhook SET failure_streak = ?, gave_up_streak = ? WHERE id = ?`, w.failure_streak + 1, gaveUp, w.id);
    ctx.emit("webhook.delivery_failed", w.id, {
      deliveryId: d.id, webhookId: w.id, eventId: d.event_id, ...(status !== undefined ? { httpStatus: status } : {}), error: error ?? "The delivery failed.", attempts, willRetry,
    });
    if (state === "gave_up" && gaveUp >= DISABLE_AFTER_GAVE_UP) {
      ctx.db.run(`UPDATE events_webhook SET active = 0, version = ?, updated_at = ? WHERE id = ?`, w.version + 1, now, w.id);
      ctx.emit("webhook.disabled", w.id, { webhookId: w.id, reason: `${DISABLE_AFTER_GAVE_UP} deliveries in a row gave up after 24 hours of retries.` });
    }
    if (willRetry && nextAt !== null) {
      await ctx.schedule(nextAt, "webhooks.send_delivery", { webhookId: w.id, eventId: d.event_id, attempt: attempts + 1, idempotencyKey: `${w.id}:${d.event_id}:${attempts + 1}` });
    }
  }
  return next;
}

/** The delivery of one event to one webhook, attempt `attempt` (called by the events.webhooks_out consumer, and by the scheduler for each retry). */
export async function webhooksSendDelivery(ctx: EventsCtx, input: { webhookId: string; eventId: string; attempt: number }) {
  const w = mustWebhook(ctx, input.webhookId);
  let d = ctx.db.all(`SELECT * FROM events_delivery WHERE webhook_id = ? AND event_id = ? AND kind = ?`, w.id, input.eventId, "event")[0] as DeliveryRec | undefined;
  // a delivery already finished, or an attempt already made (a repeated call), changes nothing
  if (d && (["delivered", "failed", "gave_up"].includes(d.state) || input.attempt <= d.attempts)) return { delivery: deliveryOut(d) };
  if (!d || d.body === null) {
    // the body is the event as the webhook's owner may read it; an event that is gone or no longer readable ends the delivery
    const row = await hostPorts(ctx).events.get({ principal: w.created_by }, input.eventId);
    if (!d) {
      if (!row) return raise(ctx, "validation.not_found", "no such event");
      d = newDelivery(ctx, w, { eventId: row.id, eventType: row.type, kind: "event", body: deliveryBody(row, w.id) });
    } else if (row) d = { ...d, body: deliveryBody(row, w.id) };
    else {
      const gone: DeliveryRec = { ...d, state: "failed", last_error: "The event can no longer be read.", at: ctx.now(), next_attempt_at: null };
      saveDelivery(ctx, gone);
      return { delivery: deliveryOut(gone) };
    }
  }
  return { delivery: deliveryOut(await attempt(ctx, w, d, true)) };
}

export async function webhooksTest(ctx: EventsCtx, input: { webhookId: string }) {
  const w = mustWebhook(ctx, input.webhookId);
  const eventId = nid("evt", 12);
  const body = JSON.stringify({
    id: eventId, type: "webhook.test", sv: 1, seq: 0, at: ctx.now(), traceId: ctx.trace.traceId, actor: ctx.principal.id,
    payload: { message: "This is a test event from Vyre." }, webhookId: w.id,
  });
  const d = newDelivery(ctx, w, { eventId, eventType: "webhook.test", kind: "test", body });
  return { delivery: deliveryOut(await attempt(ctx, w, d, false)) };
}

export async function webhooksReplayDelivery(ctx: EventsCtx, input: { deliveryId: string }) {
  const src = deliveryById(ctx, input.deliveryId) ?? raise(ctx, "validation.not_found", "no such delivery");
  const w = mustWebhook(ctx, src.webhook_id);
  if (src.body === null) raise(ctx, "validation.bad_input", "That delivery was never sent, so there is nothing to send again.");
  const d = newDelivery(ctx, w, { eventId: src.event_id, eventType: src.event_type, kind: "replay", body: src.body, replayOf: src.id });
  return { delivery: deliveryOut(await attempt(ctx, w, d, false)) };
}

// ---------------------------------------------------------------- health

export async function webhooksHealth(ctx: EventsCtx, _input: Record<string, never>) {
  const head = hostIfSet() ? await hostIfSet()!.events.head() : null;
  const lag = head === null ? 0 : Math.max(0, head - lastSeq(ctx));
  const failing = (ctx.db.all(`SELECT COUNT(*) AS n FROM events_webhook WHERE deleted_at IS NULL AND active = 1 AND failure_streak > 0`)[0] as { n: number }).n;
  const stuck = (ctx.db.all(`SELECT COUNT(*) AS n FROM events_delivery WHERE state = ? AND next_attempt_at < ?`, "pending", ctx.now() - 5 * 60_000)[0] as { n: number }).n;
  const last = ctx.db.all(`SELECT duration_ms FROM events_delivery WHERE state = ? ORDER BY at DESC LIMIT 1`, "delivered")[0] as { duration_ms: number | null } | undefined;
  const latency = last?.duration_ms ?? undefined;
  let state: "healthy" | "degraded" | "down" = "healthy", detail: string | undefined;
  if (head === null) { state = "down"; detail = "Event reading and delivery are not set up on this server."; }
  else if (lag > 1000) { state = "down"; detail = `Delivery is ${lag} events behind.`; }
  else if (stuck > 0) { state = "degraded"; detail = `${stuck} deliveries have waited more than 5 minutes to start.`; }
  else if (lag > 100) { state = "degraded"; detail = `Delivery is ${lag} events behind.`; }
  else if (failing > 0) { state = "degraded"; detail = `${failing} webhook${failing === 1 ? " is" : "s are"} failing.`; }
  return { state, ...(detail ? { detail } : {}), ...(latency !== undefined ? { latencyMs: latency } : {}), lagEvents: lag, failing };
}

