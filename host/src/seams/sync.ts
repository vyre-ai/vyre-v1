// The sync module's host seam (rulings 31 and 32): the module exports `hostSeams = { configureSync }` and the daemon hands it what only the host has: the Space store, the access snapshot,
// the clock, the registry hash and a way to run a pushed op as the person through the invoke pipeline. The host never imports the module, so the shapes below are the structural subset of
// the module's SyncHostSeam. A push op runs exactly like the same call over HTTP: permissions, Gate, validation and audit are the normal ones.
import type { InlineProjection } from "../../../kernel/src/store/projection.ts";
import type { InvokeResult } from "../invoke.ts";
import type { SyncHubPort } from "../ws.ts";

/** One capability call made for a pushed op (the structural subset of sync's InvokeCall). */
export interface SyncInvokeCall {
  cap: string; v: number; input: unknown; principal: string; deviceId: string; idempotencyKey: string;
  /** the op's own trace id: the change and its events carry it, so one flow is one trace */
  traceId?: string;
}

/** What the sync module hands the host: a factory for its live hub. The hub opens the Space store, so the host calls the factory only after every module has declared its projections. */
export type SyncLiveHubFactory = () => SyncHubPort;
/** The host WebSocket hub as the module's purge port needs it: it frames a purge to the sockets concerned and closes them. */
export interface SyncHostHub { purge(person: string, epoch: number): number; purgeDevice(person: string, device: string, epoch: number): number }

/** The half of the live hub seam the module sees (structural subset of the module's SyncHostSeam.liveHub). */
export interface SyncLiveSeam {
  provide(factory: SyncLiveHubFactory): void;
  host(): SyncHostHub | null;
}

/**
 * The bridge between the sync module's live hub and the host WebSocket. The module registers a lazy factory through `seam`; the host asks `port` for a hub only when a device connects (after boot),
 * once. If the factory fails, every connection is refused and closed: a socket never falls back to a hub that does not filter. `provided()` tells the daemon whether the module offered one at all.
 */
export function createSyncLiveBridge(log: (msg: string, attrs?: Record<string, unknown>) => void = () => {}) {
  let factory: SyncLiveHubFactory | null = null;
  let hub: SyncHubPort | null = null;
  let failed = false;
  let host: SyncHostHub | null = null;
  const get = (): SyncHubPort | null => {
    if (hub || failed || !factory) return hub;
    try { hub = factory(); } catch (e) { failed = true; log("sync.live.unavailable", { error: e instanceof Error ? e.message : String(e) }); }
    return hub;
  };
  const port: SyncHubPort = {
    accept(t, who) {
      const h = get();
      if (!h) { t.close("sync.unavailable"); return { close() {} }; }
      return h.accept(t, who);
    },
    commit() { hub?.commit(); },
    close() { const h = hub; hub = null; factory = null; h?.close?.(); },
  };
  return {
    seam: { provide: (f: SyncLiveHubFactory) => { factory = f; hub = null; failed = false; }, host: () => host } satisfies SyncLiveSeam,
    port,
    provided: () => factory !== null,
    setHost(h: SyncHostHub | null): void { host = h; },
  };
}

export interface SyncSeamDeps {
  store: { declare(extra: readonly InlineProjection[]): void; open(): unknown };
  access(): unknown;
  space: string;
  now(): number;
  registryHash: string;
  /** invoke as a person from a device */
  invoke(cap: string, input: unknown, seed: { space: string; principal: { kind: "person"; id: string }; device: string; v: number; origin: string; trace?: { traceId: string; spanId: string } }): Promise<InvokeResult>;
  /** true when the capability's input takes an idempotencyKey, so the op id can be its key */
  keyed(cap: string, v: number): boolean;
  /** run the conflicts module's host calls */
  conflicts?: { open(c: unknown): Promise<string>; history(e: unknown): Promise<void> };
  endpoints?(): { kind: "direct" | "relay" | "tunnel"; url: string }[];
  /** where the module registers its live hub factory and finds the host hub for purges */
  liveHub?: SyncLiveSeam;
}

const spanId = (): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

export function createSyncSeam(d: SyncSeamDeps) {
  return {
    store: d.store, access: d.access, now: d.now, registryHash: d.registryHash,
    ...(d.endpoints ? { endpoints: d.endpoints } : {}),
    ...(d.liveHub ? { liveHub: d.liveHub } : {}),
    ...(d.conflicts ? { conflicts: d.conflicts } : {}),
    async invoke(call: SyncInvokeCall): Promise<{ kind: "applied" } | { kind: "held"; taskId: string }> {
      const body = call.input !== null && typeof call.input === "object" && !Array.isArray(call.input) ? (call.input as Record<string, unknown>) : {};
      const input = d.keyed(call.cap, call.v) && body["idempotencyKey"] === undefined ? { ...body, idempotencyKey: call.idempotencyKey } : call.input;
      const r = await d.invoke(call.cap, input, { space: d.space, principal: { kind: "person", id: call.principal }, device: call.deviceId, v: call.v, origin: "sync", ...(call.traceId ? { trace: { traceId: call.traceId, spanId: spanId() } } : {}) });
      return r.status === "held" ? { kind: "held", taskId: r.taskId } : { kind: "applied" };
    },
  };
}
