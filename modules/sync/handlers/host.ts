// What the host gives the sync module at boot (ruling 31/32 seam `configureSync`) and the handlers that need it: the push ports over the sync store, hello, status, health, endpoints, entities,
// devices.lag and the document capabilities. The store is the Space's one record store (the sync.changes projection is declared on it before it opens), so rows the records module writes are in the feed.
import { createHash } from "node:crypto";
import type { AccessSnapshot } from "../../../kernel/src/authorize/snapshot.ts";
import type { InlineProjection, ProjectionHost, Tx } from "../../../kernel/src/store/projection.ts";
import type { Store } from "../../../kernel/src/store/types.ts";
import { decideHello } from "../../../sync/src/handshake/decide.ts";
import { deviceEpochOf, deviceRevoked, epochOf, headSeq, pullError } from "../../../sync/src/server/pull/index.ts";
import type { Catalog, PullDeps } from "../../../sync/src/server/pull/index.ts";
import { catalogPolicy, catalogRestricted } from "../../../sync/src/server/push/policy.ts";
import { syncRowClocks } from "../../../sync/src/server/push/clocks.ts";
import type { InvokeCall, PushDeps } from "../../../sync/src/server/push/types.ts";
import type { DeviceClass, Hello } from "../../../sync/src/protocol.ts";
import type { DocRowRef } from "./docs.ts";

/** The shared Space store as the data modules see it (host/src/daemon/store.ts). */
export interface SyncStoreSeam {
  declare(extra: readonly InlineProjection[]): void;
  open(): { host: ProjectionHost; store: Store; tx: Tx };
}

export interface SyncEndpoint { kind: "direct" | "relay" | "tunnel"; url: string; rttMs?: number }

export interface SyncHostSeam {
  store: SyncStoreSeam;
  /** The in-memory access projections, read at call time. */
  access(): AccessSnapshot;
  now(): number;
  /** The registry hash this server runs (5.2). */
  registryHash: string;
  serverVersion?: string;
  /** Run the capability as the person through the invoke pipeline (permissions, Gate, validation, audit). Throws a VyreErr when refused. */
  invoke(call: InvokeCall): Promise<{ kind: "applied" } | { kind: "held"; taskId: string }>;
  /** Where devices reach this Space; none known: an empty list. */
  endpoints?(): SyncEndpoint[];
  /** Fingerprint of the Space key, for the pairing screen. */
  fingerprint?(): string;
}

const DDL = `
CREATE TABLE IF NOT EXISTS sync_device_cursor (person TEXT NOT NULL, device TEXT NOT NULL, class TEXT NOT NULL, cursor INTEGER NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY (person, device)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sync_history (entity TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, hlc TEXT NOT NULL, actor TEXT NOT NULL, value TEXT, seq INTEGER NOT NULL, reason TEXT NOT NULL, PRIMARY KEY (entity, id, field, hlc, actor)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sync_conflict (id TEXT PRIMARY KEY, entity TEXT NOT NULL, row_id TEXT NOT NULL, field TEXT NOT NULL, op_id TEXT NOT NULL, ours TEXT, theirs TEXT, base INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'open', created INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sync_applied (op_id TEXT PRIMARY KEY, seq INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sync_once (principal TEXT NOT NULL, cap TEXT NOT NULL, key TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY (principal, cap, key)) WITHOUT ROWID;`;
const made = new WeakSet<object>();
export function ensureHostTables(db: Tx): void {
  if (made.has(db)) return;
  db.exec(DDL);
  made.add(db);
}

/** A pull by a device records where it got to; status, health and lag read it. */
export function noteCursor(db: Tx, person: string, device: string, deviceClass: DeviceClass, cursor: number, at: number): void {
  ensureHostTables(db);
  db.run("INSERT INTO sync_device_cursor (person, device, class, cursor, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(person, device) DO UPDATE SET cursor = max(cursor, excluded.cursor), class = excluded.class, last_seen = excluded.last_seen", person, device, deviceClass, cursor, at);
}

/** The ports of the push server over the sync store: field clocks from sync_rows, policy from the entity catalog, history, parked conflicts, applied seqs and idempotent effects in the module's own tables. */
export function pushDepsOf(deps: PullDeps, seam: SyncHostSeam): PushDeps {
  const db = deps.db;
  ensureHostTables(db);
  return {
    now: deps.now, hlc: deps.hlc,
    epochOf: (person) => epochOf(db, person),
    deviceRevoked: (person, device) => deviceRevoked(db, person, device),
    async invoke(call) {
      const r = await seam.invoke(call);
      if (r.kind === "held") return r;
      const seq = headSeq(db);
      db.run("INSERT OR IGNORE INTO sync_applied (op_id, seq) VALUES (?, ?)", call.idempotencyKey, seq);
      return { kind: "applied", seq };
    },
    clocks: syncRowClocks(db),
    appliedSeq: (opId) => db.get<{ seq: number }>("SELECT seq FROM sync_applied WHERE op_id = ?", opId)?.seq,
    policy: catalogPolicy(deps.catalog), restricted: catalogRestricted(deps.catalog),
    history(e) {
      db.run("INSERT OR IGNORE INTO sync_history (entity, id, field, hlc, actor, value, seq, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", e.entity, e.id, e.field, e.hlc, e.actor, JSON.stringify(e.value ?? null), e.seq, e.reason);
    },
    openConflict(c) {
      const id = `cfl_${createHash("sha256").update(`${c.opId}\u0000${c.field}`).digest("hex").slice(0, 24)}`;
      db.run("INSERT OR IGNORE INTO sync_conflict (id, entity, row_id, field, op_id, ours, theirs, base, state, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)",
        id, c.entity, c.id, c.field, c.opId, JSON.stringify(c.ours ?? null), JSON.stringify(c.theirs ?? null), c.base, deps.now());
      return id;
    },
    async once(principal, cap, key, _input, run) {
      const hit = db.get<{ result: string }>("SELECT result FROM sync_once WHERE principal = ? AND cap = ? AND key = ?", principal, cap, key);
      if (hit) return JSON.parse(hit.result) as never;
      const out = await run();
      db.run("INSERT OR IGNORE INTO sync_once (principal, cap, key, result) VALUES (?, ?, ?, ?)", principal, cap, key, JSON.stringify(out ?? null));
      return out;
    },
  };
}

/** The document a capability names is the id of the row that owns it; access is that row's. */
export function docRowOf(deps: PullDeps): (doc: string) => DocRowRef | undefined {
  return (doc) => {
    const r = deps.db.get<{ entity: string; id: string; owner_id: string | null; enc: number }>("SELECT entity, id, owner_id, enc FROM sync_rows WHERE id = ? AND deleted = 0 LIMIT 1", doc);
    if (!r) return undefined;
    return { type: deps.catalog.get(r.entity).resource, resource: r.id, owner: { entity: r.entity, id: r.id }, ...(r.enc === 2 ? { enc: 2 as const, ownerId: r.owner_id ?? undefined } : {}) };
  };
}

interface InfoCtx { trace: { traceId: string }; principal: { id: string }; device?: string }
const versionsOf = (catalog: Catalog, db: Tx): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const e of catalog.known()) out[e.key] = 1;
  for (const r of db.all<{ entity: string }>("SELECT DISTINCT entity FROM sync_rows")) out[r.entity] = 1;
  return out;
};

/** hello, status, health, endpoints, entities and devices.lag: what a device and the Console ask about sync itself. */
export function createInfoHandlers(deps: PullDeps, seam: SyncHostSeam) {
  const db = deps.db;
  const state = (person: string, device: string) => ({
    serverVersion: seam.serverVersion ?? "1.0.0", epoch: deviceEpochOf(db, person, device), head: headSeq(db), serverHlc: deps.hlc(),
    registryHash: seam.registryHash, compatibleRegistryHashes: [], olderRegistryHashes: [], entityVersions: versionsOf(deps.catalog, db),
  });
  const cursors = () => db.all<{ person: string; device: string; class: DeviceClass; cursor: number; last_seen: number }>("SELECT person, device, class, cursor, last_seen FROM sync_device_cursor ORDER BY device");
  const openConflicts = (): number => db.get<{ n: number }>("SELECT count(*) AS n FROM sync_conflict WHERE state = 'open'")?.n ?? 0;
  const start = (): void => ensureHostTables(db);
  return {
    "sync.hello": async (ctx: InfoCtx, input: Hello) => {
      start();
      const device = ctx.device ?? input.deviceId;
      if (deviceRevoked(db, ctx.principal.id, device)) throw pullError("auth.device_revoked", "This device was removed. Sign in again.", ctx.trace.traceId);
      return decideHello(input, state(ctx.principal.id, device)).ok;
    },
    "sync.status": async (ctx: InfoCtx, input: { deviceId?: string }) => {
      start();
      const device = input.deviceId ?? ctx.device ?? "";
      const person = ctx.principal.id;
      const row = db.get<{ cursor: number }>("SELECT cursor FROM sync_device_cursor WHERE person = ? AND device = ?", person, device);
      const head = headSeq(db), cursor = row?.cursor ?? 0;
      return { head, cursor, lag: Math.max(0, head - cursor), epoch: deviceEpochOf(db, person, device), openConflicts: openConflicts(), mode: deviceRevoked(db, person, device) ? "purge" as const : "live" as const };
    },
    "sync.health": async () => {
      start();
      const head = headSeq(db);
      const slowest = cursors().reduce((m, c) => Math.max(m, head - c.cursor), 0);
      const state = slowest > 10_000 ? "degraded" as const : "healthy" as const;
      return { state, head, slowestCursorLag: slowest, ...(state === "degraded" ? { detail: "A device is far behind and will take a snapshot." } : {}) };
    },
    "sync.endpoints": async () => ({ endpoints: seam.endpoints?.() ?? [], spaceKeyFingerprint: seam.fingerprint?.() ?? "" }),
    "sync.entities": async (_ctx: InfoCtx, input: { deviceClass?: DeviceClass }) => {
      const cls = input.deviceClass ?? "desktop";
      return {
        entities: deps.catalog.known().map((e) => ({ entity: e.key, version: 1, profile: e.profile[cls], ...(e.window.days !== undefined ? { windowDays: e.window.days } : {}) })),
        registryHash: seam.registryHash,
      };
    },
    "sync.devices.lag": async (_ctx: InfoCtx, input: { cursor?: string; limit?: number }) => {
      start();
      const head = headSeq(db), limit = input.limit ?? 100;
      const all = cursors().filter((c) => input.cursor === undefined || c.device > input.cursor);
      const page = all.slice(0, limit);
      return {
        devices: page.map((c) => ({ deviceId: c.device, personId: c.person, deviceClass: c.class, cursor: c.cursor, lag: Math.max(0, head - c.cursor), lastSeen: c.last_seen })),
        total: cursors().length,
        ...(all.length > limit ? { next: page[page.length - 1]!.device } : {}),
      };
    },
  };
}
