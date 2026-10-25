// @reads /modules/sources/migrations/0001_sources.sql
// Sources module (lane L3). The host loads these handlers once the manifest status is live (ARCH 12.4).
// Records are reached through the capability API (ctx.call), so this module owns only its own tables. Standalone (tests, the loader entry below) it opens a kernel store
// for a database handle; the host passes the Space's tx when it builds the handle. The signing secret comes from deps.secret (the Vault resolved server side).
import { readFileSync } from "node:fs";
import { openRecordStore } from "../../kernel/src/store/records.ts";
import type { ProjectionHost, Tx } from "../../kernel/src/store/projection.ts";
import type { Store } from "../../kernel/src/store/types.ts";
import { createSourcesHandlers } from "./handlers/index.ts";
import type { SourcesHandlers } from "./handlers/index.ts";
import { ensureTables } from "./projections.ts";
import type { SourcesCtx, SourcesDeps, SourcesRegistry } from "./projections.ts";

export function loadRegistry(path: URL = new URL("../../generated/registry.json", import.meta.url)): SourcesRegistry {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { connectors: SourcesRegistry["connectors"] };
  return { connectors: raw.connectors };
}

export interface SourcesHandle { deps: SourcesDeps; tx: Tx; store?: Store; host?: ProjectionHost; handlers: SourcesHandlers }

export function openSources(o: Partial<Omit<SourcesDeps, "tx">> & { tx?: Tx; path?: string; space?: string } = {}): SourcesHandle {
  let tx = o.tx;
  let host: ProjectionHost | undefined;
  let store: Store | undefined;
  if (!tx) {
    const opened = openRecordStore({ path: o.path ?? ":memory:", space: o.space ?? "sp_sources" });
    host = opened.host;
    store = opened.store;
    tx = opened.host.tx;
  }
  const deps: SourcesDeps = {
    tx, registry: o.registry ?? loadRegistry(),
    ...(o.now ? { now: o.now } : {}), ...(o.secret ? { secret: o.secret } : {}), ...(o.reachable ? { reachable: o.reachable } : {}), ...(o.maxBodyBytes ? { maxBodyBytes: o.maxBodyBytes } : {}),
  };
  ensureTables(tx);
  return { deps, tx, ...(store ? { store } : {}), ...(host ? { host } : {}), handlers: createSourcesHandlers(deps) };
}

// ---- loader entry ----

type HostCtx = { trace: { traceId: string }; emit(name: string, subject: string, payload: Record<string, unknown>): unknown; call(cap: string, input: unknown): Promise<unknown>; principal?: { id: string } };
let shared: SourcesHandle | null = null;
const live = (): SourcesHandle => (shared ??= openSources());

function adapt(name: keyof SourcesHandlers): (ctx: HostCtx, input: never) => Promise<unknown> {
  return (ctx, input) => {
    const sc: SourcesCtx = { trace: ctx.trace, emit: (n, s, p) => ctx.emit(n, s, p), call: (c, i) => ctx.call(c, i), ...(ctx.principal ? { actor: ctx.principal.id } : {}) };
    return (live().handlers[name] as (c: SourcesCtx, i: unknown) => Promise<unknown>)(sc, input);
  };
}

const NAMES = [
  "sources.list", "sources.get", "sources.kinds", "sources.create", "sources.update", "sources.set_secret", "sources.pause", "sources.resume", "sources.delete",
  "sources.preview_mapping", "sources.deliveries.list", "sources.replay", "sources.ingest", "sources.link.match", "sources.link.list_pending", "sources.link.resolve", "sources.health",
] as const satisfies readonly (keyof SourcesHandlers)[];

export const handlers = Object.fromEntries(NAMES.map((n) => [n, adapt(n)])) as Record<(typeof NAMES)[number], (ctx: HostCtx, input: never) => Promise<unknown>>;
export { createSourcesHandlers };
export { runSync, undoPush, retryPush, flushOutbox, confirmDeletes, resolveConflict, removedAtSource } from "./handlers/index.ts";
export const SYNC_RUN_KIND = "connector_sync";

/** The Vault resolves a webhook signing secret by item name, for one delivery only (deps.secret). */
export function setSourcesSecretResolver(fn: ((name: string) => Promise<string | undefined>) | null): void {
  if (fn) live().deps.secret = fn; else delete live().deps.secret;
}
/** Where the host hands its half at boot (ruling 31): the loader reads this export and the daemon calls each setter with the driver of the same name. */
export const hostSeams = { setSourcesSecretResolver };
