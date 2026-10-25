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
import type { DeviceClass, PullReq, PushReq } from "../../sync/src/protocol.ts";
import { createPullHandlers, createPushHandlers, toPullCtx } from "./handlers/index.ts";
import { createPurgeHandlers, purgeDepsOf, toPurgeCtx } from "./handlers/purge.ts";
import type { LiveHub } from "../../sync/src/live/index.ts";
import type { BumpInput, ReindexInput } from "../../sync/src/purge/index.ts";
import type { PullHandlers } from "./handlers/index.ts";
import { syncChanges } from "./projections.ts";

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
  const opened = openRecordStore({
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
type SessionCtx = Pick<Ctx, "trace" | "principal"> & { device?: string };

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

function live(): SyncHandle {
  if (!shared) shared = openSync({ access: () => { throw new Error("sync has no access snapshot: the host calls useSync first"); } });
  return shared;
}

export const handlers = {
  "sync.pull": (ctx: SessionCtx, input: PullReq) => live().handlers["sync.pull"](toPullCtx(ctx), input),
  "sync.snapshot.begin": (ctx: SessionCtx, input: { entities?: string[]; deviceClass: DeviceClass }) => live().handlers["sync.snapshot.begin"](toPullCtx(ctx, input.deviceClass), input),
  "sync.snapshot.page": (ctx: SessionCtx, input: { entity: string; after?: string; asOf: number }) => live().handlers["sync.snapshot.page"](toPullCtx(ctx), input),
  "sync.push": (ctx: SessionCtx, input: PushReq) => {
    if (!pushDeps) {
      throw new VyreErr({ code: "internal.unavailable", message: "This server is not taking pushes yet.", retryable: true, traceId: ctx.trace.traceId, next: [{ kind: "retry", label: "Try again in a moment" }] });
    }
    // the host gives push what it knows; a device's own epoch row is in the sync store, so push reads revocation from there
    return createPushHandlers({ deviceRevoked: (person, device) => deviceRevoked(live().deps.db, person, device), ...pushDeps })["sync.push"](toPullCtx(ctx), input);
  },
  // admin calls (ARCH 5.7): the devices and access modules invoke them after a revoke, a removal or a label change
  "sync.epoch.bump": (ctx: SessionCtx, input: BumpInput) => createPurgeHandlers(purgeDepsOf(live(), hub))["sync.epoch.bump"](toPurgeCtx(ctx), input),
  "sync.acl.reindex": (ctx: SessionCtx, input: ReindexInput) => createPurgeHandlers(purgeDepsOf(live(), hub))["sync.acl.reindex"](toPurgeCtx(ctx), input),
};
