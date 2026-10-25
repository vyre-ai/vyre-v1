// @reads /modules/connectors/migrations/0001_connectors.sql
// Connectors module (lane L3). The host loads these handlers once the manifest status is live (ARCH 12.4).
// Secrets arrive through deps.resolveSecret (the Vault, resolved server side at call time); this module stores only handles. Standalone (tests, the loader entry below) it opens a kernel
// store for a database handle; the host passes the Space's tx when it builds the handle.
import { readFileSync } from "node:fs";
import { openRecordStore } from "../../kernel/src/store/records.ts";
import type { ProjectionHost, Tx } from "../../kernel/src/store/projection.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";
import type { SpaceStoreSeam } from "../../host/src/daemon/store.ts";
import { createConnectorsHandlers } from "./handlers/index.ts";
import type { ConnectorsHandlers } from "./handlers/index.ts";
import { ensureTables, seedBuiltins } from "./projections.ts";
import type { BuiltinRow, ConnectorsCtx } from "./projections.ts";
import type { SyncDeps, SyncEngine } from "./handlers/sync.ts";

export function loadBuiltins(path: URL = new URL("../../generated/registry.json", import.meta.url)): BuiltinRow[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { connectors: BuiltinRow[] }).connectors;
}

export interface ConnectorsHandle { deps: SyncDeps; tx: Tx; host?: ProjectionHost; handlers: ConnectorsHandlers }

export function openConnectors(o: Partial<Omit<SyncDeps, "tx">> & { tx?: Tx; path?: string; space?: string } = {}): ConnectorsHandle {
  let tx = o.tx;
  let host: ProjectionHost | undefined;
  if (!tx) {
    const opened = openRecordStore({ path: o.path ?? ":memory:", space: o.space ?? "sp_connectors" });
    host = opened.host;
    tx = opened.host.tx;
  }
  const { tx: _t, path: _p, space: _s, builtins, ...rest } = o as Partial<SyncDeps> & { path?: string; space?: string };
  void _t; void _p; void _s;
  const deps: SyncDeps = { ...rest, tx, builtins: builtins ?? loadBuiltins() };
  ensureTables(tx);
  seedBuiltins(deps);
  return { deps, tx, ...(host ? { host } : {}), handlers: createConnectorsHandlers(deps) };
}

// ---- loader entry ----

type HostCtx = Omit<ConnectorsCtx, "actor"> & { principal?: { id: string } };
let shared: ConnectorsHandle | null = null;
let spaceSeam: SpaceStoreSeam | null = null;
let engine: SyncEngine | null = null;
/** The host hands the Space store (P-H_08, ruling 31). */
export function setConnectorsSpaceStore(seam: SpaceStoreSeam | null): void { spaceSeam = seam; shared = null; }
export const hostSeams: SeamSetters = { setConnectorsSpaceStore };
const live = (): ConnectorsHandle => {
  if (!shared) {
    shared = openConnectors(spaceSeam ? { tx: spaceSeam.open().tx } : {});
    if (engine) shared.deps.engine = engine;
  }
  return shared;
};
/** The host hands the sync engine (modules/sources) to the live handlers: preview, undo, conflict settling, replay, confirm deletes and push need it (boundary B1 keeps this module from importing it). */
export function setSyncEngine(e: SyncEngine): void { engine = e; if (shared) shared.deps.engine = e; }

function adapt(name: keyof ConnectorsHandlers): (ctx: HostCtx, input: never) => Promise<unknown> {
  return (ctx, input) => {
    const cc: ConnectorsCtx = {
      trace: ctx.trace, emit: (n, s, p) => ctx.emit(n, s, p), call: (c, i) => ctx.call(c, i), http: (u, i) => ctx.http(u, i),
      ...(ctx.log ? { log: ctx.log } : {}), ...(ctx.principal ? { actor: ctx.principal.id } : {}),
    };
    return (live().handlers[name] as (c: ConnectorsCtx, i: unknown) => Promise<unknown>)(cc, input);
  };
}

const NAMES = [
  "connectors.list", "connectors.get", "connectors.init", "connectors.build", "connectors.test", "connectors.run", "connectors.diff", "connectors.publish", "connectors.versions",
  "connectors.rollback", "connectors.export", "connectors.remove", "connectors.health",
  "connections.list", "connections.get", "connections.create", "connections.update", "connections.pause", "connections.resume", "connections.reconnect", "connections.complete_auth",
  "connections.test", "connections.delete",
  "sync_types.list", "sync_types.get", "sync_types.discover", "sync_types.create", "sync_types.update", "sync_types.preview", "sync_types.pause", "sync_types.resume", "sync_types.log",
  "sync_types.schema_changes", "sync_types.review_schema", "sync_types.confirm_deletes", "sync_types.make_native", "sync_types.resolve_conflict", "sync_types.replay_conflict", "sync_types.undo_push",
  "connectors.sync_now", "connectors.outbox.list", "connectors.outbox.retry", "connectors.outbox.cancel", "connectors.push",
] as const satisfies readonly (keyof ConnectorsHandlers)[];

export const handlers = Object.fromEntries(NAMES.map((n) => [n, adapt(n)])) as Record<(typeof NAMES)[number], (ctx: HostCtx, input: never) => Promise<unknown>>;
export { createConnectorsHandlers };
export { executeAction, runCases, diffDefs, noteSchemaChanges, syncRequest } from "./handlers/index.ts";
