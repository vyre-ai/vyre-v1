// @reads /modules/connectors/migrations/0001_connectors.sql
// Connectors module (lane L3). The host loads these handlers once the manifest status is live (ARCH 12.4).
// Secrets arrive through deps.resolveSecret (the Vault, resolved server side at call time); this module stores only handles. Standalone (tests, the loader entry below) it opens a kernel
// store for a database handle; the host passes the Space's tx when it builds the handle.
import { readFileSync } from "node:fs";
import { openRecordStore } from "../../kernel/src/store/records.ts";
import type { ProjectionHost, Tx } from "../../kernel/src/store/projection.ts";
import { createConnectorsHandlers } from "./handlers/index.ts";
import type { ConnectorsHandlers } from "./handlers/index.ts";
import { ensureTables, seedBuiltins } from "./projections.ts";
import type { BuiltinRow, ConnectorsCtx, ConnectorsDeps } from "./projections.ts";

export function loadBuiltins(path: URL = new URL("../../generated/registry.json", import.meta.url)): BuiltinRow[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { connectors: BuiltinRow[] }).connectors;
}

export interface ConnectorsHandle { deps: ConnectorsDeps; tx: Tx; host?: ProjectionHost; handlers: ConnectorsHandlers }

export function openConnectors(o: Partial<Omit<ConnectorsDeps, "tx">> & { tx?: Tx; path?: string; space?: string } = {}): ConnectorsHandle {
  let tx = o.tx;
  let host: ProjectionHost | undefined;
  if (!tx) {
    const opened = openRecordStore({ path: o.path ?? ":memory:", space: o.space ?? "sp_connectors" });
    host = opened.host;
    tx = opened.host.tx;
  }
  const { tx: _t, path: _p, space: _s, builtins, ...rest } = o as Partial<ConnectorsDeps> & { path?: string; space?: string };
  void _t; void _p; void _s;
  const deps: ConnectorsDeps = { ...rest, tx, builtins: builtins ?? loadBuiltins() };
  ensureTables(tx);
  seedBuiltins(deps);
  return { deps, tx, ...(host ? { host } : {}), handlers: createConnectorsHandlers(deps) };
}

// ---- loader entry ----

type HostCtx = Omit<ConnectorsCtx, "actor"> & { principal?: { id: string } };
let shared: ConnectorsHandle | null = null;
const live = (): ConnectorsHandle => (shared ??= openConnectors());

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
] as const satisfies readonly (keyof ConnectorsHandlers)[];

export const handlers = Object.fromEntries(NAMES.map((n) => [n, adapt(n)])) as Record<(typeof NAMES)[number], (ctx: HostCtx, input: never) => Promise<unknown>>;
export { createConnectorsHandlers };
export { executeAction, runCases, diffDefs } from "./handlers/index.ts";
