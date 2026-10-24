// @reads /modules/sync/migrations/0001_pull.sql
// The sync module's server side. `openSync` is a host with the records and sync.changes projections and the pull handlers over it; the kernel fills the access snapshot, tests fill their own.
import { formatHlc, tickHlc } from "../../lib/hlc.ts";
import type { Hlc } from "../../lib/hlc.ts";
import type { AccessSnapshot } from "../../kernel/src/authorize/snapshot.ts";
import { openRecordStore } from "../../kernel/src/store/records.ts";
import type { ProjectionHost } from "../../kernel/src/store/projection.ts";
import type { Store } from "../../kernel/src/store/types.ts";
import { LABEL_RANKS, ScopeCache, loadCatalog } from "../../sync/src/server/pull/index.ts";
import type { Catalog, PullDeps } from "../../sync/src/server/pull/index.ts";
import { createPullHandlers } from "./handlers/index.ts";
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
