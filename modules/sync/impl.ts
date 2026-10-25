// @reads /modules/sync/migrations/0001_pull.sql
// The sync module's server side. `openSync` is a host with the records and sync.changes projections and the pull handlers over it; the kernel fills the access snapshot, tests fill their own.
import { formatHlc, tickHlc } from "../../lib/hlc.ts";
import type { Hlc } from "../../lib/hlc.ts";
import type { AccessSnapshot } from "../../kernel/src/authorize/snapshot.ts";
import { openRecordStore } from "../../kernel/src/store/records.ts";
import type { ProjectionHost } from "../../kernel/src/store/projection.ts";
import type { Store } from "../../kernel/src/store/types.ts";
import { LABEL_RANKS, ScopeCache, deviceRevoked, loadCatalog } from "../../sync/src/server/pull/index.ts";
import type { Catalog, PullDeps } from "../../sync/src/server/pull/index.ts";
import { VyreErr } from "../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import type { PushDeps } from "../../sync/src/server/push/index.ts";
import type { ConflictOpen } from "../../sync/src/server/push/types.ts";
import type { DeviceClass, PullReq, PushReq } from "../../sync/src/protocol.ts";
import { createPullHandlers, createPushHandlers, toPullCtx } from "./handlers/index.ts";
import { createPurgeHandlers, purgeDepsOf, toPurgeCtx } from "./handlers/purge.ts";
import type { LiveHub } from "../../sync/src/live/index.ts";
import type { BumpInput, ReindexInput } from "../../sync/src/purge/index.ts";
import type { PullHandlers } from "./handlers/index.ts";
import { syncChanges } from "./projections.ts";
import type { DocHandlers } from "./handlers/docs.ts";
import { createInfoHandlers, docRowOf, noteCursor, pushDepsOf } from "./handlers/host.ts";
import type { SyncHostSeam } from "./handlers/host.ts";
import type { ProjectionHost as Host } from "../../kernel/src/store/projection.ts";
import type { Store as KStore } from "../../kernel/src/store/types.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";
export type { SyncHostSeam, SyncEndpoint, SyncStoreSeam } from "./handlers/host.ts";

export interface SyncOpts {
  /** The in-memory access projections (grants, roles, resources). */
  access: () => AccessSnapshot;
  path?: string;
  space?: string;
  actor?: string;
  clock?: () => number;
  /** Setting sync.phone_label_ceiling. */
  phoneCeiling?: () => "public" | "internal" | "confidential";
  /** True when the person starred or follows the row, so a phone keeps it whatever its age. */
  keep?: (person: string, entity: string, id: string) => boolean;
  catalog?: Catalog;
  /** An already open record store (the Space's), on which the sync.changes projection was declared; omitted: the sync module opens its own at `path`. */
  store?: { host: Host; store: KStore };
}

export interface SyncHandle {
  host: ProjectionHost;
  store: Store;
  handlers: PullHandlers;
  deps: PullDeps;
  catalog: Catalog;
  /** Set a person's sync epoch (the epoch.bump packet owns the capability; the pull side only reads it). */
  setEpoch(person: string, epoch: number): void;
}

export function openSync(o: SyncOpts): SyncHandle {
  const catalog = o.catalog ?? loadCatalog();
  const clock = o.clock ?? Date.now;
  const opened = o.store ?? openRecordStore({
    path: o.path ?? ":memory:", space: o.space ?? "sp_sync",
    extra: [syncChanges((entity) => catalog.get(entity).ownerField)],
    ...(o.actor !== undefined ? { actor: o.actor } : {}),
    clock,
  });
  const host = opened.host;
  let last: Hlc | null = null;
  const deps: PullDeps = {
    db: host.tx,
    catalog,
    cache: new ScopeCache(o.access),
    now: clock,
    hlc: () => { last = tickHlc("srv", clock(), last); return formatHlc(last); },
    phoneCeiling: () => LABEL_RANKS[o.phoneCeiling?.() ?? "confidential"],
    keep: o.keep ?? (() => false),
  };
  return {
    host, store: opened.store, handlers: createPullHandlers(deps), deps, catalog,
    setEpoch(person, epoch) { host.tx.run("INSERT INTO sync_epoch (person, epoch) VALUES (?, ?) ON CONFLICT(person) DO UPDATE SET epoch = excluded.epoch", person, epoch); },
  };
}

// ---- loader entry (P-H_02). The loader reads `handlers` once the manifest is live: capability name to handler, each taking the host Ctx as the device session.
type SessionCtx = Pick<Ctx, "trace" | "principal"> & { device?: string; emit?: Ctx["emit"] };

let shared: SyncHandle | null = null;
let pushDeps: PushDeps | null = null;
/** The host gives the module the server's own sync handle (its access snapshot and record store); null puts the default back. */
export function useSync(h: SyncHandle | null): void { shared = h; }
/** The host gives sync.push what only it can supply: invoke as the person, the epoch, the field clocks, history, conflicts, idempotency. */
export function setPushDeps(d: PushDeps | null): void { pushDeps = d; }

type Hub = Pick<LiveHub, "purge"> & { purgeDevice?: (person: string, device: string, epoch: number) => number };
let hub: Hub = { purge: () => 0 };
/** The host gives the module its live hub, so a purge also closes the sockets it concerns; until then a purge only raises the epoch (the next pull or hello answers purge). */
export function setLiveHub(h: Hub | null): void { hub = h ?? { purge: () => 0 }; }

let seam: SyncHostSeam | null = null;
let docs: DocHandlers | null = null;
let info: ReturnType<typeof createInfoHandlers> | null = null;
/**
 * The host's half (ruling 31/32): the Space store, the access snapshot, the clock, the registry hash and the way to run a capability as a person. Declaring the sync.changes projection on the
 * Space store here, before it is first opened, puts every record the Space writes into the feed. Null takes it all back out.
 */
export function configureSync(s: SyncHostSeam | null): void {
  seam = s; shared = null; pushDeps = null; docs = null; info = null;
  if (s) s.store.declare([syncChanges((entity) => loadCatalog().get(entity).ownerField)]);
}
export const hostSeams: SeamSetters = { configureSync };

function live(): SyncHandle {
  if (!shared) {
    shared = seam
      ? openSync({ access: seam.access, clock: seam.now, store: seam.store.open() })
      : openSync({ access: () => { throw new Error("sync has no access snapshot: the host calls useSync first"); } });
  }
  return shared;
}
function pushOf(): PushDeps | null {
  if (pushDeps) return pushDeps;
  return seam ? (pushDeps = pushDepsOf(live().deps, seam)) : null;
}
/** The document handlers load on first use: they need yjs, which a server that never opens a document should not have to carry at boot. */
async function docHandlers(): Promise<DocHandlers> {
  if (!docs) {
    const m = await import("./handlers/docs.ts");
    const h = live();
    docs = m.createDocHandlers(m.docServerOf(h, { access: m.snapshotDocAccess({ snapshot: seam ? seam.access : () => { throw new Error("sync has no access snapshot: the host calls configureSync first"); }, rowOf: docRowOf(h.deps), now: h.deps.now }), now: h.deps.now }));
  }
  return docs;
}
function infoHandlers() {
  if (!info) {
    if (!seam) throw new Error("sync is not set up on this server: the host calls configureSync first");
    info = createInfoHandlers(live().deps, seam);
  }
  return info;
}

export const handlers = {
  "sync.pull": async (ctx: SessionCtx, input: PullReq) => {
    const res = await live().handlers["sync.pull"](toPullCtx(ctx), input);
    if (ctx.device) noteCursor(live().deps.db, ctx.principal.id, ctx.device, "desktop", (res as { next?: number }).next ?? input.cursor, live().deps.now());
    return res;
  },
  "sync.snapshot.begin": (ctx: SessionCtx, input: { entities?: string[]; deviceClass: DeviceClass }) => live().handlers["sync.snapshot.begin"](toPullCtx(ctx, input.deviceClass), input),
  "sync.snapshot.page": (ctx: SessionCtx, input: { entity: string; after?: string; asOf: number }) => live().handlers["sync.snapshot.page"](toPullCtx(ctx), input),
  "sync.push": (ctx: SessionCtx, input: PushReq) => {
    const pd = pushOf();
    if (!pd) {
      throw new VyreErr({ code: "internal.unavailable", message: "This server is not taking pushes yet.", retryable: true, traceId: ctx.trace.traceId, next: [{ kind: "retry", label: "Try again in a moment" }] });
    }
    // the host gives push what it knows; a device's own epoch row is in the sync store, so push reads revocation from there
    return createPushHandlers({ deviceRevoked: (person, device) => deviceRevoked(live().deps.db, person, device), ...pd,
      // a collision parked in the conflicts module is announced, so the module can route it to the assistant or to Needs you
      ...(seam?.conflicts && ctx.emit ? {
        async openConflict(c: ConflictOpen) {
          const id = await pd.openConflict(c);
          ctx.emit!("conflict.opened", `entity/${id}`, { conflictId: id, entity: c.entity, recordId: c.id, field: c.field, actor: c.theirsActor, plainChoice: c.plainChoice, traceId: c.traceId });
          return id;
        },
      } : {}) })["sync.push"](toPullCtx(ctx), input);
  },
  // admin calls (ARCH 5.7): the devices and access modules invoke them after a revoke, a removal or a label change
  "sync.epoch.bump": (ctx: SessionCtx, input: BumpInput) => createPurgeHandlers(purgeDepsOf(live(), hub))["sync.epoch.bump"](toPurgeCtx(ctx), input),
  "sync.acl.reindex": (ctx: SessionCtx, input: ReindexInput) => createPurgeHandlers(purgeDepsOf(live(), hub))["sync.acl.reindex"](toPurgeCtx(ctx), input),
  // the device-facing questions about sync itself, and the documents (ARCH 5.2, 5.6)
  "sync.hello": (ctx: SessionCtx, input: never) => infoHandlers()["sync.hello"](ctx, input),
  "sync.status": (ctx: SessionCtx, input: never) => infoHandlers()["sync.status"](ctx, input),
  "sync.health": (_ctx: SessionCtx) => infoHandlers()["sync.health"](),
  "sync.endpoints": (_ctx: SessionCtx) => infoHandlers()["sync.endpoints"](),
  "sync.entities": (ctx: SessionCtx, input: never) => infoHandlers()["sync.entities"](ctx, input),
  "sync.devices.lag": (ctx: SessionCtx, input: never) => infoHandlers()["sync.devices.lag"](ctx, input),
  "sync.doc.open": async (ctx: SessionCtx, input: never) => (await docHandlers())["sync.doc.open"]({ trace: ctx.trace, principal: ctx.principal.id }, input),
  "sync.doc.update": async (ctx: SessionCtx, input: never) => (await docHandlers())["sync.doc.update"]({ trace: ctx.trace, principal: ctx.principal.id }, input),
  "sync.doc.close": async (ctx: SessionCtx, input: never) => (await docHandlers())["sync.doc.close"]({ trace: ctx.trace, principal: ctx.principal.id }, input),
  "sync.doc.compact": async (ctx: SessionCtx, input: never) => (await docHandlers())["sync.doc.compact"]({ trace: ctx.trace, principal: ctx.principal.id }, input),
};
