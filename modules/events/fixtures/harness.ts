// A harness for the events handlers: the in-memory SQL engine behind the host's table guard, a ctx with a reversible seal, recorded emits, schedules and calls, and the two host ports
// built from the REAL port code (createEventLogPort over an in-memory log, createWebhookPostPort over a scripted network). Nothing here talks to a network or a disk.
import { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import type { StoredEvent } from "../../../kernel/src/log/types.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { createEventLogPort, createWebhookPostPort } from "../../../host/src/seams/events-ports.ts";
import type { EventsHostSeam, PostFetch, PostInit } from "../../../host/src/seams/events-ports.ts";
import { FakeEventsDb, NOW, SPACE, TRACE } from "./db.ts";
import { setEventsHost } from "../projections.ts";
import type { EventsCtx } from "../projections.ts";

export { NOW, SPACE, TRACE };
export { FakeEventsDb };

export interface Emitted { name: string; subject: string; payload: unknown }
export interface Scheduled { at: number | string; cap: string; input: unknown }
export interface Called { cap: string; input: unknown; opts?: unknown }
export interface Sent { url: string; init: PostInit }
export type Reply = { status: number; body?: string; location?: string } | "hang" | "down";

const enc = new TextEncoder();

export function snapshot(): AccessSnapshot {
  const s = new AccessSnapshot();
  s.putRole({ id: "member", clearance: 1, perms: [], name: "Member" });
  s.putRole({ id: "admin", clearance: 3, perms: ["connectors.manage", "server.logs"], name: "Admin" });
  for (const id of ["usr_a1b2c3", "usr_member"]) s.putPrincipal({ id, kind: "person", status: "active" });
  s.addPrincipalRole({ holder: "usr_a1b2c3", role: "admin" });
  s.addPrincipalRole({ holder: "usr_member", role: "member" });
  return s;
}

let seq = 0;
/** A stored event as the log would hold it (payload JSON bytes). */
export function logged(o: Partial<StoredEvent> & { type: string; payload?: unknown }): StoredEvent {
  seq++;
  const { payload, ...rest } = o;
  return {
    seq: o.seq ?? seq, id: o.id ?? `evt_${String(seq).padStart(6, "0")}`, sv: 1, hlc: "0", at: NOW, trace_id: TRACE, actor: "usr_a1b2c3", depth: 0, label: 0, vis: "space", enc: 0,
    commit: "", prev: "", hash: "", ...rest, payload: enc.encode(JSON.stringify(payload ?? {})),
  } as StoredEvent;
}

export interface Harness {
  raw: FakeEventsDb;
  emitted: Emitted[];
  scheduled: Scheduled[];
  calls: Called[];
  sent: Sent[];
  /** the events the in-memory log holds; push to it to add more */
  log: StoredEvent[];
  /** what the next POSTs answer, in order; empty answers 200 */
  replies: Reply[];
  host: EventsHostSeam;
  /** the network's view of the clock, used by the port for durations */
  advance(ms: number): void;
  now(): number;
  as(id: string, o?: { actingFor?: string }): EventsCtx;
  system(): EventsCtx;
}

export function harness(o: { allow?: string[]; timeoutMs?: number } = {}): Harness {
  const raw = new FakeEventsDb();
  const db = scopedDb("events", raw, TRACE);
  const emitted: Emitted[] = [], scheduled: Scheduled[] = [], calls: Called[] = [], sent: Sent[] = [];
  const log: StoredEvent[] = [];
  const replies: Reply[] = [];
  let clock = NOW;
  const snap = snapshot();
  const net: PostFetch = async (url, init) => {
    sent.push({ url, init });
    const r = replies.shift() ?? { status: 200, body: "ok" };
    if (r === "hang") return new Promise(() => { /* never answers; the port's timeout ends it */ });
    if (r === "down") throw new Error("ECONNREFUSED");
    return { status: r.status, headers: { get: (n: string) => (n.toLowerCase() === "location" ? r.location ?? null : null) }, text: async () => r.body ?? "" };
  };
  const host: EventsHostSeam = {
    events: createEventLogPort({
      source: { read: (q) => log.filter((e) => e.seq > (q.after ?? 0) && (q.trace_id === undefined || e.trace_id === q.trace_id) && (q.run_id === undefined || e.run_id === q.run_id) && (q.entity === undefined || e.entity === q.entity) && (q.entity_id === undefined || e.entity_id === q.entity_id)).slice(0, q.limit ?? 500), head: () => log.at(-1)?.seq ?? 0 },
      access: () => snap, owner: () => "usr_a1b2c3", now: () => clock,
    }),
    webhooks: createWebhookPostPort({ allow: () => o.allow ?? ["*"], fetch: net, now: () => clock, ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) }),
  };
  setEventsHost(host);   // the handlers read the ports the host registered at boot
  const base = {
    space: SPACE, trace: { traceId: TRACE, spanId: "abcdef0123456789" }, now: () => clock, db,
    emit(name: string, subject: string, payload: unknown) { emitted.push({ name, subject, payload }); return {} as never; },
    async call(cap: string, input: unknown, opts?: unknown) {
      calls.push({ cap, input, opts });
      if (cap === "runs.start") return { runId: "run_a1b2c3" };
      return {};
    },
    async schedule(at: number | string, cap: string, input: unknown) { scheduled.push({ at, cap, input }); return "sch_1"; },
    seal: {
      seal: (v: Uint8Array, scope: string) => ({ keyId: `k1/${scope}`, nonce: "nonce", bytes: Buffer.from(v).toString("base64") }),
      unseal: (s: { bytes: string }) => new Uint8Array(Buffer.from(s.bytes, "base64")),
    },
  };
  return {
    raw, emitted, scheduled, calls, sent, log, replies, host,
    advance(ms) { clock += ms; }, now: () => clock,
    as: (id, x = {}) => ({ ...base, principal: { kind: "person", id }, ...(x.actingFor ? { actingFor: x.actingFor } : {}) }) as unknown as EventsCtx,
    system: () => ({ ...base, principal: { kind: "service", id: "svc_events" } }) as unknown as EventsCtx,
  };
}

/** Append an event to the in-memory log with the next seq and a fresh id. */
export function addEvent(h: Harness, o: Partial<StoredEvent> & { type: string; payload?: unknown }): StoredEvent {
  const n = (h.log.at(-1)?.seq ?? 0) + 1;
  const e = logged({ ...o, seq: n, id: o.id ?? `evt_t${String(n).padStart(5, "0")}` });
  h.log.push(e);
  return e;
}

export function codeOf(e: unknown): string | undefined {
  if (!e || typeof e !== "object" || !("error" in e)) return undefined;
  return (e as { error?: { code?: string } }).error?.code;
}

/** The webhook, delivery and event the generated examples name (whk_a1b2c3, dlv_a1b2c3, evt_a1b2c3), owned by usr_a1b2c3. The signing secret is `whsec_seed`. */
export function seedExampleWorld(h: Harness): void {
  const sealed = JSON.stringify({ keyId: "k1/events.webhook", nonce: "nonce", bytes: Buffer.from("whsec_seed").toString("base64") });
  h.raw.run(
    `INSERT INTO events_webhook (id, name, url, event_types, filter, active, secret, secret_hint, created_by, created_at, last_delivery_at, failure_streak, gave_up_streak, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "whk_a1b2c3", "Seed hook", "https://hooks.example.com/in", JSON.stringify(["record.*"]), null, 1, sealed, "seed", "usr_a1b2c3", NOW - 10_000, null, 0, 0, 0, NOW - 10_000, null);
  const body = JSON.stringify({ id: "evt_a1b2c3", type: "record.updated", sv: 1, seq: 1, at: NOW - 5000, traceId: TRACE, actor: "usr_a1b2c3", payload: {}, webhookId: "whk_a1b2c3" });
  h.raw.run(
    `INSERT INTO events_delivery (id, webhook_id, event_id, event_type, kind, replay_of, state, attempts, http_status, last_error, at, first_at, next_attempt_at, duration_ms, body, trace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "dlv_a1b2c3", "whk_a1b2c3", "evt_a1b2c3", "record.updated", "event", null, "delivered", 1, 200, null, NOW - 4000, NOW - 5000, null, 12, body, TRACE);
  h.log.push(logged({ seq: 1, id: "evt_a1b2c3", type: "record.updated", entity: "conflict", entity_id: "cfl_a1b2c3", run_id: "run_a1b2c3", payload: {} }));
}
